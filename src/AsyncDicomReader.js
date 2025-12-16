import { ReadBufferStream } from "./BufferStream";
import { ValueRepresentation } from "./ValueRepresentation";
import {
    EXPLICIT_BIG_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    VM_DELIMITER,
    UNDEFINED_LENGTH,
    TagHex
} from "./constants/dicom";
import { Tag } from "./Tag";
import { DicomMessage, singleVRs } from "./DicomMessage";
import { DicomMetaDictionary } from "./DicomMetaDictionary";
import { DicomMetadataListener } from "./utilities";

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
        this.fmi = await this.readFmi(options);
        const listener = options?.listener || new DicomMetadataListener();
        this.dict ||= {};
        listener.startObject(this.dict);
        await this.read(listener, options);
        this.dict = listener.pop();

        return this;
    }

    async readFmi(options = null) {
        const { stream } = this;
        await stream.ensureAvailable();
        const { offset: metaStartPos } = stream;
        const el = this.readTagHeader();
        if (el.tag !== "00020000") {
            // meta length tag is missing
            if (!options?.ignoreErrors) {
                throw new Error(
                    "Invalid DICOM file, meta length tag is malformed or not present."
                );
            }

            // reset stream to the position where we started reading tags
            stream.offset = metaStartPos;
            // Wait for at least 10k to be available to make sure there is enough
            // data to read the entire FMI
            await stream.ensureAvailable(1024 * 10);

            // read meta header elements sequentially
            this.fmi = DicomMessage._read(stream, EXPLICIT_LITTLE_ENDIAN, {
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
            this.fmi = DicomMessage._read(
                metaStream,
                EXPLICIT_LITTLE_ENDIAN,
                {}
            );
        }
        this.syntax = this.fmi["00020010"].Value[0];

        return this.fmi;
    }

    async read(listener, options) {
        const { stream } = this;
        await stream.ensureAvailable();
        while (stream.isAvailable(1, false)) {
            // Consume before reading the tag so that data before the
            // current tag can be cleared.
            stream.consume();
            const tagInfo = this.readTagHeader(options);
            const { tag, tagObj, length } = tagInfo;

            if (tag === TagHex.ItemDelimitationEnd) {
                return listener.pop();
            }
            if (tagObj.isInstruction()) {
                console.warn("SKipping instruction:", tag);
                continue;
            }
            if (tagObj.group() === 0) {
                // Group length
                stream.increment(tagObj.length);
                continue;
            }
            listener.addTag(tag, tagInfo);
            if (this.isSequence(tagInfo)) {
                await this.readSequence(listener, tagInfo, options);
            } else if (tagObj.isPixelDataTag()) {
                await this.readPixelData(listener, tagInfo);
            } else if (length === -1) {
                throw new Error(
                    `Can't handle tag ${tagInfo.tag} with -1 length and not sequence`
                );
            } else {
                await this.readSingle(tagInfo, listener);
            }
            listener.pop();
            await this.stream.ensureAvailable();
        }
    }

    async readSequence(listener, tagInfo, options) {
        const { length } = tagInfo;
        const { stream, syntax } = this;
        const endOffset =
            length === -1 ? Number.MAX_SAFE_INTEGER : stream.offset + length;
        const dest = [];
        listener.startArray(dest);
        while (stream.offset < endOffset && (await stream.ensureAvailable())) {
            const tagInfo = await this.readTagHeader(syntax, options);
            const { tag } = tagInfo;
            if (tag === TagHex.Item) {
                listener.startObject();
                const result = await this.read(listener, options);
                dest.push(result);
            } else if (tag === TagHex.SequenceDelimitationEnd) {
                listener.pop();
                return dest;
            } else {
                console.warn("Unknown tag info", length, tagInfo);
                throw new Error();
            }
        }
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
        const startOffset = stream.offset;

        let frameNumber = 0;
        let lastFrame = null;

        while (true) {
            stream.consume();
            await stream.ensureAvailable();
            const frameTag = this.readTagHeader();
            if (frameTag.tag === TagHex.SequenceDelimitationEnd) {
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
                offsets?.length > frameNumber &&
                stream.offset < offsets[frameNumber] + startOffset
            ) {
                lastFrame ||= [];
                lastFrame.push(frame);
            } else if (lastFrame) {
                lastFrame.push(frame);
                listener.value(lastFrame);
                lastFrame = null;
            } else {
                listener.value(frame);
            }
            frameNumber++;
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
        return offsets;
    }

    /**
     * Reads uncompressed pixel data, delivering it to the listener streaming it.
     */
    async readUncompressed(listener, tagInfo) {
        const { length } = tagInfo;
        const { stream } = this;

        const numberOfFrames = listener.getValue("00280008");
        if (!numberOfFrames || parseInt(numberOfFrames) === 1) {
            await stream.ensureAvailable(length);
            const arrayBuffer = stream.readUint8Array(length);
            listener.value(arrayBuffer.buffer);
            return [arrayBuffer.buffer];
        }
        const rows = listener.getValue("00280010");
        const cols = listener.getValue("00280011");
        const samplesPerPixel = listener.getValue("00280002");
        const bitsAllocated = listener.getValue("00280100");
        const bitsPerFrame = rows * cols * samplesPerPixel * bitsAllocated;
        if (bitsPerFrame % 8 !== 0) {
            throw new Error(
                `Single bit odd length not supported: ${rows},${cols} ${samplesPerPixel} ${bitsAllocated}`
            );
        }
        const frameLength = bitsPerFrame / 8;

        console.warn(
            "Reading pixel data tag",
            length,
            numberOfFrames,
            rows,
            cols,
            samplesPerPixel,
            bitsAllocated
        );
        for (let frameNumber = 0; frameNumber < numberOfFrames; frameNumber++) {
            await stream.ensureAvailable(frameLength);
            const arrayBuffer = stream.readUint8Array(frameLength);
            listener.value(arrayBuffer);
            stream.consume();
        }
    }

    isSequence(tagInfo) {
        const { vr, length } = tagInfo;
        return vr === "SQ" || (vr === "UN" && length === -1);
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
                if (length == 0xffffffff) {
                    vrType = "SQ";
                } else if (tagObj.isPixelDataTag()) {
                    vrType = "OW";
                } else if (vrType == "xs") {
                    vrType = "US";
                } else if (tagObj.isPrivateCreator()) {
                    vrType = "LO";
                } else {
                    vrType = "UN";
                }
            }
            vr = ValueRepresentation.createByTypeString(vrType);
        } else {
            vrType = stream.readVR();

            if (
                vrType === "UN" &&
                DicomMessage.lookupTag(tagObj) &&
                DicomMessage.lookupTag(tagObj).vr
            ) {
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

    async readSingle(tagInfo, listener) {
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

        values.forEach(value => listener.value(value));
        return values;
    }
}
