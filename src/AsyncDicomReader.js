import { ReadBufferStream } from "./BufferStream";
import { ValueRepresentation } from "./ValueRepresentation";
import {
    EXPLICIT_BIG_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    VM_DELIMITER,
    UNDEFINED_LENGTH,
    TagHex,
    encodingMapping,
    UNDEFINED_LENGTH_FIX
} from "./constants/dicom";
import { Tag } from "./Tag";
import { DicomMessage, singleVRs } from "./DicomMessage";
import { DicomMetaDictionary } from "./DicomMetaDictionary";
import { DicomMetadataListener } from "./utilities/DicomMetadataListener.js";
import { log } from "./log.js";

/**
 * This is an asynchronous binary DICOM reader.
 *
 * Assume this is still preliminary as to the exact interface as it is
 * initially being released for testing purposes only.
 *
 * There is no support for compressed streams.
 */
export class AsyncDicomReader {
    syntax = EXPLICIT_LITTLE_ENDIAN;

    constructor(options = {}) {
        this.isLittleEndian = options?.isLittleEndian;
        this.stream = new ReadBufferStream(null, this.isLittleEndian, {
            clearBuffers: true,
            ...options
        });
    }

    /**
     * Reads the preamble and checks for the DICM marker.
     * Returns true if found/read, leaving the stream past the
     * marker, or false, having not found the marker.
     */
    async readPreamble() {
        const { stream } = this;
        await stream.ensureAvailable();
        stream.reset();
        stream.increment(128);
        if (stream.readAsciiString(4) !== "DICM") {
            stream.reset();
            return false;
        }
        return true;
    }

    async readFile(options = undefined) {
        const hasPreamble = await this.readPreamble();
        if (!hasPreamble) {
            throw new Error("TODO - can't handle no preamble file");
        }
        this.meta = await this.readMeta(options);
        const listener = options?.listener || new DicomMetadataListener();

        if (listener.information) {
            const { information } = listener;
            information.transferSyntaxUid = this.syntax;
            information.sopInstanceUid =
                this.meta?.[TagHex.MediaStoreSOPInstanceUID]?.Value[0];
        }

        this.dict ||= {};
        listener.startObject(this.dict);
        this.dict = await this.read(listener, options);

        return this;
    }

    /**
     * Reads the file meta information.
     *
     * @param options.maxSizeMeta - maximum number of bytes for reading the meta
     *      header when it isn't in a group length section.
     * @param options.ignoreErrors - allow reading past some errors.
     *        In this case, reading a meta section not inside a group length.
     */
    async readMeta(options = undefined) {
        const { stream } = this;
        await stream.ensureAvailable();
        const { offset: metaStartPos } = stream;
        const el = this.readTagHeader();
        if (el.tag !== TagHex.FileMetaInformationGroupLength) {
            // meta length tag is missing
            if (!options?.ignoreErrors) {
                throw new Error(
                    "Invalid DICOM file, meta length tag is malformed or not present."
                );
            }

            // reset stream to the position where we started reading tags
            stream.offset = metaStartPos;
            // Wait for at least 10k to be available to make sure there is enough
            // data to read the entire Meta header
            await stream.ensureAvailable(options?.maxSizeMeta || 1024 * 10);

            // read meta header elements sequentially
            this.meta = DicomMessage._read(stream, EXPLICIT_LITTLE_ENDIAN, {
                untilTag: "00030000",
                stopOnGreaterTag: true,
                ignoreErrors: true
            });
        } else {
            // meta length tag is present
            const metaLength = el.vrObj.readBytes(stream);
            await stream.ensureAvailable(metaLength);

            // read header buffer using the specified meta length
            const metaStream = stream.more(metaLength);
            this.meta = DicomMessage._read(
                metaStream,
                EXPLICIT_LITTLE_ENDIAN,
                {}
            );
        }
        this.syntax = this.meta[TagHex.TransferSyntaxUID].Value[0];

        return this.meta;
    }

    async read(listener, options) {
        const untilOffset = options?.untilOffset || Number.MAX_SAFE_INTEGER;
        this.listener = listener;
        const { stream } = this;
        await stream.ensureAvailable();
        while (stream.offset < untilOffset && stream.isAvailable(1, false)) {
            // Consume before reading the tag so that data before the
            // current tag can be cleared.
            stream.consume();
            const tagInfo = this.readTagHeader(options);
            const { tag, tagObj, length } = tagInfo;

            if (tag === TagHex.ItemDelimitationEnd) {
                return listener.pop();
            }
            if (tagObj.isInstruction()) {
                continue;
            }
            if (tagObj.group() === 0 || tag === TagHex.DataSetTrailingPadding) {
                // Group length
                stream.increment(tagObj.length);
                continue;
            }
            const addTagResult = listener.addTag(tag, tagInfo);
            if (this.isSequence(tagInfo)) {
                await this.readSequence(listener, tagInfo, options);
            } else if (tagObj.isPixelDataTag()) {
                await this.readPixelData(listener, tagInfo);
            } else if (length === UNDEFINED_LENGTH_FIX) {
                throw new Error(
                    `Can't handle tag ${tagInfo.tag} with -1 length and not sequence`
                );
            } else if (addTagResult?.expectsRaw === true && length > 0) {
                // Deliver raw binary data when requested
                await this.readRawBinary(listener, tagInfo);
            } else {
                await this.readSingle(tagInfo, listener, options);
            }
            listener.pop();
            await this.stream.ensureAvailable();
        }
        return listener.pop();
    }

    async readSequence(listener, sqTagInfo, options) {
        const { length } = sqTagInfo;
        const { stream, syntax } = this;
        const endOffset =
            length === UNDEFINED_LENGTH_FIX
                ? Number.MAX_SAFE_INTEGER
                : stream.offset + length;
        const dest = [];
        listener.startArray(dest);
        while (stream.offset < endOffset && (await stream.ensureAvailable())) {
            const tagInfo = this.readTagHeader(syntax, options);
            const { tag } = tagInfo;
            if (tag === TagHex.Item) {
                listener.startObject();
                const result = await this.read(listener, {
                    ...options,
                    untilOffset: endOffset
                });
                dest.push(result);
            } else if (tag === TagHex.SequenceDelimitationEnd) {
                // Sequence of undefined lengths end in sequence delimitation item
                listener.pop();
                return dest;
            } else {
                console.warn("Unknown tag info", length, tagInfo);
                throw new Error();
            }
        }
        // Sequences of defined length end at the end offset
        listener.pop();
    }

    readPixelData(listener, tagInfo) {
        if (tagInfo.length === -1) {
            return this.readCompressed(listener, tagInfo);
        }

        return this.readUncompressed(listener, tagInfo);
    }

    /**
     * Reads compressed streams.
     */
    async readCompressed(listener, _tagInfo) {
        const { stream } = this;

        await stream.ensureAvailable();

        const offsets = await this.readOffsets();
        if (offsets?.length) {
            // Last frame ends when the sequence ends, so merge the frame data
            offsets.push(Number.MAX_SAFE_INTEGER / 2);
        }
        const startOffset = stream.offset;

        let frameNumber = 0;
        let lastFrame = null;

        while (true) {
            stream.consume();
            await stream.ensureAvailable();
            const frameTag = this.readTagHeader();
            if (frameTag.tag === TagHex.SequenceDelimitationEnd) {
                if (lastFrame) {
                    listener.value(
                        lastFrame.length === 1 ? lastFrame[0] : lastFrame
                    );
                }
                return;
            }
            if (frameTag.tag !== TagHex.Item) {
                throw new Error(`frame tag isn't item: ${frameTag.tag}`);
            }
            const { length } = frameTag;
            await stream.ensureAvailable(length);
            const frame = stream.readArrayBuffer(length);
            // Collect values into an array for child elements
            if (
                offsets?.length &&
                stream.offset < offsets[frameNumber + 1] + startOffset
            ) {
                lastFrame ||= [];
                lastFrame.push(frame);
            } else if (lastFrame) {
                lastFrame.push(frame);
                listener.value(
                    lastFrame.length === 1 ? lastFrame[0] : lastFrame
                );
                lastFrame = null;
                frameNumber++;
                // console.log(stream.getBufferMemoryInfo());
            } else {
                listener.value(frame);
                frameNumber++;
                // console.log(stream.getBufferMemoryInfo());
            }
        }
    }

    async readOffsets() {
        const tagInfo = this.readTagHeader();
        if (tagInfo.tag !== TagHex.Item) {
            throw new Error(`Offsets tag is missing: ${tagInfo.tag}`);
        }
        if (tagInfo.length === 0) {
            return;
        }
        const offsets = [];
        const numOfFrames = tagInfo.length / 4;
        await this.stream.ensureAvailable(tagInfo.length);
        for (let i = 0; i < numOfFrames; i++) {
            offsets.push(this.stream.readUint32());
        }
        if (offsets.length === 1) {
            // Don't merge single frames or video
            return [];
        }
        return offsets;
    }

    /**
     * Reads uncompressed pixel data, delivering it to the listener streaming it.
     */
    async readUncompressed(listener, tagInfo) {
        const { length } = tagInfo;
        const { stream } = this;

        const numberOfFrames = listener.information?.numberOfFrames;
        if (!numberOfFrames || parseInt(numberOfFrames) === 1) {
            await stream.ensureAvailable(length);
            const arrayBuffer = stream.readUint8Array(length);
            listener.value(arrayBuffer.buffer);
            // console.log(stream.getBufferMemoryInfo());
            return [arrayBuffer.buffer];
        }
        const rows = listener.information?.rows;
        const cols = listener.information?.columns;
        const samplesPerPixel = listener.information?.samplesPerPixel;
        const bitsAllocated = listener.information?.bitsAllocated;
        const bitsPerFrame = rows * cols * samplesPerPixel * bitsAllocated;
        if (bitsPerFrame % 8 !== 0) {
            throw new Error(
                `Single bit odd length not supported: ${rows},${cols} ${samplesPerPixel} ${bitsAllocated}`
            );
        }
        const frameLength = bitsPerFrame / 8;

        for (let frameNumber = 0; frameNumber < numberOfFrames; frameNumber++) {
            await stream.ensureAvailable(frameLength);
            const arrayBuffer = stream.readUint8Array(frameLength);
            listener.value(arrayBuffer);
            stream.consume();
            // console.log(stream.getBufferMemoryInfo());
        }
    }

    /**
     * Reads raw binary data in chunks and delivers it to the listener.
     * This method reads data in 64KB chunks to manage memory efficiently.
     */
    async readRawBinary(listener, tagInfo) {
        const { length } = tagInfo;
        const { stream } = this;
        const CHUNK_SIZE = 64 * 1024; // 64KB chunks

        let remainingBytes = length;

        while (remainingBytes > 0) {
            const chunkSize = Math.min(CHUNK_SIZE, remainingBytes);
            await stream.ensureAvailable(chunkSize);
            const chunk = stream.readArrayBuffer(chunkSize);
            listener.value(chunk);
            remainingBytes -= chunkSize;

            // Consume the buffer to free up memory between chunks
            stream.consume();
            // console.log(stream.getBufferMemoryInfo());
        }
    }

    isSequence(tagInfo) {
        const { vr, length } = tagInfo;
        return vr === "SQ" || (vr === "UN" && length === UNDEFINED_LENGTH_FIX);
    }

    /**
     * Reads a tag header.
     */
    readTagHeader(
        options = {
            untilTag: null,
            includeUntilTagValue: false
        }
    ) {
        const { stream, syntax } = this;
        const { untilTag, includeUntilTagValue } = options;
        const implicit = syntax == IMPLICIT_LITTLE_ENDIAN;
        const isLittleEndian = syntax !== EXPLICIT_BIG_ENDIAN;
        stream.setEndian(isLittleEndian);
        const tagObj = Tag.readTag(stream);
        const tag = tagObj.cleanString;

        if (untilTag && untilTag === tag) {
            if (!includeUntilTagValue) {
                return { tag, tagObj, vr: 0, values: 0, untilTag: true };
            }
        }

        let length = null;
        let vr = null;
        let vrType;

        const isCommand = tagObj.group() === 0;
        if (tagObj.isInstruction()) {
            length = stream.readUint32();
            vr = ValueRepresentation.createByTypeString("UN");
        } else if (implicit && !isCommand) {
            length = stream.readUint32();
            var elementData = DicomMessage.lookupTag(tagObj);
            if (elementData) {
                vrType = elementData.vr;
            } else {
                //unknown tag
                if (length == UNDEFINED_LENGTH) {
                    vrType = "SQ";
                } else if (tagObj.isPixelDataTag()) {
                    vrType = "OW";
                } else if (vrType == "xs") {
                    // This should work for any tag after PixelRepresentation,
                    // which is all but 2 of the xs code values.
                    const signed =
                        this.listener.information?.pixelRepresentation === 0;
                    vrType = signed ? "SS" : "US";
                } else if (tagObj.isPrivateCreator()) {
                    vrType = "LO";
                } else {
                    vrType = "UN";
                }
            }
            vr = ValueRepresentation.createByTypeString(vrType);
        } else {
            vrType = stream.readVR();

            if (vrType === "UN" && DicomMessage.lookupTag(tagObj)?.vr) {
                vrType = DicomMessage.lookupTag(tagObj).vr;

                vr = ValueRepresentation.parseUnknownVr(vrType);
            } else {
                vr = ValueRepresentation.createByTypeString(vrType);
            }

            if (vr.isLength32()) {
                stream.increment(2);
                length = stream.readUint32();
            } else {
                length = stream.readUint16();
            }
        }

        const punctuatedTag = DicomMetaDictionary.punctuateTag(tag);
        const entry = DicomMetaDictionary.dictionary[punctuatedTag];

        // Include both the string and object values for vr and tag
        const header = {
            vrObj: vr,
            vr: vr.type,
            tag,
            tagObj,
            vm: entry?.vm,
            name: entry?.name,
            length: length === UNDEFINED_LENGTH ? -1 : length
        };
        return header;
    }

    /**
     * Reads a single tag values and delivers them to the listener.
     *
     * If the tag is specific character set, will assign the decoder to that
     * character set.
     */
    async readSingle(tagInfo, listener, options) {
        const { length } = tagInfo;
        const { stream, syntax } = this;
        await this.stream.ensureAvailable(length);
        const vr = ValueRepresentation.createByTypeString(tagInfo.vr);
        let values = [];
        if (vr.isBinary() && length > vr.maxLength && !vr.noMultiple) {
            const times = length / vr.maxLength;
            let i = 0;
            while (i++ < times) {
                const { value } = vr.read(stream, vr.maxLength, syntax);
                values.push(value);
            }
        } else {
            const value = vr.read(stream, length, syntax)?.value;
            if (!vr.isBinary() && singleVRs.indexOf(vr.type) == -1) {
                values = value;
                if (typeof value === "string") {
                    const delimiterChar = String.fromCharCode(VM_DELIMITER);
                    values = vr.dropPadByte(value.split(delimiterChar));
                }
            } else if (vr.type == "OW" || vr.type == "OB") {
                values = value;
            } else {
                Array.isArray(value) ? (values = value) : values.push(value);
            }
        }

        if (tagInfo.tag === TagHex.SpecificCharacterSet) {
            if (values.length > 0) {
                let [coding] = values;
                coding = coding.replace(/[_ ]/g, "-").toLowerCase();
                if (coding in encodingMapping) {
                    coding = encodingMapping[coding];
                    this.stream.setDecoder(new TextDecoder(coding));
                } else if (options?.ignoreErrors) {
                    log.warn(
                        `Unsupported character set: ${coding}, using default character set`
                    );
                } else {
                    throw Error(`Unsupported character set: ${coding}`);
                }
            }
        }

        values.forEach(value => listener.value(value));
        return values;
    }
}
