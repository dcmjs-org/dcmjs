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
    UNDEFINED_LENGTH_FIX,
    VALID_VRS,
    isVideoTransferSyntax
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
        // Default maxFragmentSize is 128 MB (128 * 1024 * 1024 bytes)
        this.maxFragmentSize = options?.maxFragmentSize ?? 128 * 1024 * 1024;
        this.stream = new ReadBufferStream(null, this.isLittleEndian, {
            clearBuffers: true,
            ...options
        });
    }

    /**
     * Reads the preamble and checks for the DICM marker.
     * Returns true if found/read, leaving the stream past the
     * marker, or false, having not found the marker.
     *
     * If no preamble is found, attempts to detect raw LEI/LEE encoding
     * by examining the first tag structure.
     */
    async readPreamble() {
        const { stream } = this;
        await stream.ensureAvailable();
        stream.reset();
        stream.increment(128);
        if (stream.readAsciiString(4) !== "DICM") {
            stream.reset();
            // No preamble found - try to detect raw dataset encoding
            await this.detectRawEncoding();
            return false;
        }
        return true;
    }

    /**
     * Detects whether a raw dataset (no Part 10 preamble) is LEI or LEE encoded.
     * This is done by examining the first tag structure:
     * - LEI: Tag (4 bytes) + Length (4 bytes) - no VR
     * - LEE: Tag (4 bytes) + VR (2 bytes ASCII) + Length (2 or 4 bytes)
     *
     * We check if bytes 4-5 look like a valid DICOM VR (2 ASCII letters that
     * match known VR codes). If a valid VR is detected, we use LEE, otherwise LEI.
     */
    async detectRawEncoding() {
        const { stream } = this;
        await stream.ensureAvailable(8); // Need at least 8 bytes (tag + length) to detect

        stream.reset();
        stream.setEndian(true); // Little endian for both LEI and LEE

        // Read the tag (first 4 bytes)
        const group = stream.readUint16();
        stream.readUint16();

        // Verify this looks like a DICOM file - first tag should be in group 0008
        if (group !== 0x0008) {
            throw new Error(
                `Invalid DICOM file: expected first tag group to be 0x0008, found 0x${group
                    .toString(16)
                    .padStart(4, "0")}`
            );
        }

        // Check if bytes 4-5 (after tag) look like a valid VR (2 ASCII letters)
        const byte4 = stream.peekUint8(0);
        const byte5 = stream.peekUint8(1);

        // If we're going to assume LEI, check the length is even (DICOM requirement)
        // Read the length value (4 bytes after tag in LEI format) as little-endian uint32
        await stream.ensureAvailable(8); // Need at least 8 bytes (tag + length)
        const potentialLength = stream.view.getUint32(stream.offset, true); // true = little endian

        const isASCIILetter = byte => {
            return (
                (byte >= 0x41 && byte <= 0x5a) || // A-Z
                (byte >= 0x61 && byte <= 0x7a)
            ); // a-z
        };

        if (isASCIILetter(byte4) && isASCIILetter(byte5)) {
            // Check if it's a valid VR code
            const vrCandidate = String.fromCharCode(byte4, byte5).toUpperCase();
            if (VALID_VRS.has(vrCandidate)) {
                // Valid VR detected - this is LEE (Explicit Little Endian)
                this.syntax = EXPLICIT_LITTLE_ENDIAN;
            } else {
                // ASCII letters but not a valid VR - assume LEI
                // But first check if the length is odd (invalid for DICOM)
                if (potentialLength % 2 !== 0) {
                    throw new Error(
                        `Invalid DICOM file: detected LEI encoding but length is odd (${potentialLength}), which is not allowed in DICOM`
                    );
                }
                this.syntax = IMPLICIT_LITTLE_ENDIAN;
            }
        } else {
            // Not ASCII letters - must be LEI (Implicit Little Endian)
            // Check if the length is odd (invalid for DICOM)
            if (potentialLength % 2 !== 0) {
                throw new Error(
                    `Invalid DICOM file: detected LEI encoding but length is odd (${potentialLength}), which is not allowed in DICOM`
                );
            }
            this.syntax = IMPLICIT_LITTLE_ENDIAN;
        }

        // Reset stream to beginning for reading
        stream.reset();
    }

    async readFile(options = undefined) {
        const hasPreamble = await this.readPreamble();
        if (!hasPreamble) {
            // Handle raw dataset (no Part 10 preamble)
            // Encoding should already be detected in readPreamble()
            this.meta = {}; // No meta header for raw datasets
            const listener = options?.listener || new DicomMetadataListener();

            if (listener.information) {
                const { information } = listener;
                information.transferSyntaxUid = this.syntax;
            }

            this.dict ||= {};
            listener.startObject(this.dict);
            this.dict = await this.read(listener, options);

            return this;
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
                await this.readPixelData(tagInfo);
            } else if (length === UNDEFINED_LENGTH_FIX) {
                throw new Error(
                    `Can't handle tag ${tagInfo.tag} with -1 length and not sequence`
                );
            } else if (addTagResult?.expectsRaw === true && length > 0) {
                // Deliver raw binary data when requested
                await this.readRawBinary(tagInfo);
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
        while (stream.offset < endOffset && (await stream.ensureAvailable())) {
            const tagInfo = this.readTagHeader(syntax, options);
            const { tag } = tagInfo;
            if (tag === TagHex.Item) {
                listener.startObject();
                await this.read(listener, {
                    ...options,
                    untilOffset: endOffset
                });
            } else if (tag === TagHex.SequenceDelimitationEnd) {
                // Sequence of undefined lengths end in sequence delimitation item
                return;
            } else {
                console.warn("Unknown tag info", length, tagInfo);
                throw new Error();
            }
        }
        // Sequences of defined length end at the end offset
    }

    readPixelData(tagInfo) {
        if (tagInfo.length === -1) {
            return this.readCompressed(tagInfo);
        }

        return this.readUncompressed(tagInfo);
    }

    /**
     * Emits one or more listener.value() calls for a fragment, splitting if needed.
     * This does NOT start/pop any array contexts; callers control the surrounding structure.
     */
    async _emitSplitValues(length) {
        const { stream, listener } = this;
        await listener.awaitDrain?.();
        const { maxFragmentSize } = this;
        let offset = 0;
        while (offset < length) {
            const chunkSize = Math.min(maxFragmentSize, length - offset);
            await stream.ensureAvailable(chunkSize);
            const buffer = stream.readArrayBuffer(chunkSize);
            listener.value(buffer);
            offset += chunkSize;
            stream.consume();
        }
    }

    /**
     * Reads compressed streams.
     */
    async readCompressed(_tagInfo) {
        const { stream, listener } = this;
        const transferSyntaxUid = this.syntax;

        await stream.ensureAvailable();

        // Check if this is a video transfer syntax
        const isVideo = isVideoTransferSyntax(transferSyntaxUid);

        // Check number of frames - only use video logic for single frame (or undefined)
        const numberOfFrames = listener.information?.numberOfFrames;
        const isSingleFrame = !numberOfFrames || parseInt(numberOfFrames) <= 1;

        let offsets = await this.readOffsets();

        const singleArray = isVideo || isSingleFrame;

        if (singleArray && !offsets) {
            offsets = [0];
        }
        if (offsets) {
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
                    // Always deliver frames as arrays, using streaming splitFrame
                    listener.pop();
                }
                return;
            }
            if (frameTag.tag !== TagHex.Item) {
                throw new Error(`frame tag isn't item: ${frameTag.tag}`);
            }
            const { length } = frameTag;
            if (!lastFrame) {
                lastFrame = [];
                listener.startObject(lastFrame);
            }
            await this._emitSplitValues(length);

            if (
                !offsets ||
                stream.offset >= offsets[frameNumber + 1] + startOffset
            ) {
                lastFrame = null;
                listener.pop();
                frameNumber++;
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
        return offsets;
    }

    /**
     * Reads uncompressed pixel data, delivering it to the listener streaming it.
     */
    async readUncompressed(tagInfo) {
        const { length } = tagInfo;
        const { listener } = this;

        const numberOfFrames = parseInt(
            listener.information?.numberOfFrames || 1
        );
        let frameLength = length;
        if (numberOfFrames > 1) {
            const rows = listener.information?.rows;
            const cols = listener.information?.columns;
            const samplesPerPixel = listener.information?.samplesPerPixel;
            const bitsAllocated = listener.information?.bitsAllocated;
            const bitsPerFrame = rows * cols * samplesPerPixel * bitsAllocated;
            if (bitsPerFrame % 8 !== 0) {
                // Check if this is an odd-length bit frame (bitsAllocated = 1)
                if (bitsAllocated === 1) {
                    // Use readUncompressedBitFrame for odd-length bit frames
                    return await this.readUncompressedBitFrame(tagInfo);
                }
                throw new Error(
                    `Odd frame length must be single bit: ${rows},${cols} ${samplesPerPixel} ${bitsAllocated}`
                );
            }
            frameLength = bitsPerFrame / 8;
        }

        for (let frameNumber = 0; frameNumber < numberOfFrames; frameNumber++) {
            listener.startObject([]);
            await this._emitSplitValues(frameLength);
            listener.pop();
            // console.log(stream.getBufferMemoryInfo());
        }
    }

    /**
     * Reads uncompressed pixel data with support for odd frame lengths (in bits).
     * This method handles cases where frames are packed sequentially bit-by-bit,
     * without restarting at byte boundaries. Each frame is unpacked starting at byte 0.
     *
     * For odd-length bit frames:
     * - bitsAllocated is always 1 (single bit per pixel)
     * - rows * cols * samplesPerPixel is not a multiple of 8
     * - Frames are packed sequentially into bits without byte alignment
     * - Each frame is unpacked to start at byte 0
     *
     * @param {Object} tagInfo - Tag information containing length and other metadata
     */
    async readUncompressedBitFrame(tagInfo) {
        const { length } = tagInfo;
        const { listener, stream } = this;

        const numberOfFrames = parseInt(
            listener.information?.numberOfFrames || 1
        );

        const rows = listener.information?.rows;
        const cols = listener.information?.columns;
        const samplesPerPixel = listener.information?.samplesPerPixel || 1;
        const bitsAllocated = listener.information?.bitsAllocated;

        if (!rows || !cols || !bitsAllocated) {
            throw new Error(
                "Missing required pixel data information: rows, columns, or bitsAllocated"
            );
        }

        // For odd-length bit frames, bitsAllocated should be 1
        if (bitsAllocated !== 1) {
            throw new Error(
                `Odd-length bit frames require bitsAllocated=1, got ${bitsAllocated}`
            );
        }

        const bitsPerFrame = rows * cols * samplesPerPixel * bitsAllocated;
        const bytesPerFrame = Math.ceil(bitsPerFrame / 8);
        const totalBits = bitsPerFrame * numberOfFrames;
        const totalBytes = Math.ceil(totalBits / 8);
        if (totalBytes !== length) {
            throw new Error(
                `The calculated length ${totalBytes} does not match the actual length ${length}`
            );
        }

        // Read all pixel data at once since frames are packed sequentially
        await stream.ensureAvailable(length);
        const allPixelData = stream.readArrayBuffer(totalBytes);
        stream.consume();

        // Extract each frame, unpacking bits so each frame starts at byte 0
        for (let frameNumber = 0; frameNumber < numberOfFrames; frameNumber++) {
            listener.startObject([]);

            // Calculate the bit offset for this frame in the packed data
            const bitOffset = frameNumber * bitsPerFrame;

            // Create a buffer for this frame (starting at byte 0)
            const frameBuffer = new ArrayBuffer(bytesPerFrame);
            const frameView = new Uint8Array(frameBuffer);
            const sourceView = new Uint8Array(allPixelData);

            // Extract bits for this frame
            for (let bitIndex = 0; bitIndex < bitsPerFrame; bitIndex++) {
                const globalBitIndex = bitOffset + bitIndex;
                const sourceByteIndex = Math.floor(globalBitIndex / 8);
                const sourceBitIndex = globalBitIndex % 8;
                const targetByteIndex = Math.floor(bitIndex / 8);
                const targetBitIndex = bitIndex % 8;

                // Read the bit from source
                const sourceByte = sourceView[sourceByteIndex];
                const bitValue = (sourceByte >> (7 - sourceBitIndex)) & 1;

                // Write the bit to target (starting at byte 0)
                if (bitValue) {
                    frameView[targetByteIndex] |= 1 << (7 - targetBitIndex);
                }
            }

            // Deliver the frame buffer
            listener.value(frameBuffer);
            listener.pop();
        }
    }

    /**
     * Reads raw binary data in chunks and delivers it to the listener.
     * This method reads data in 64KB chunks to manage memory efficiently.
     */
    async readRawBinary(tagInfo) {
        const { length } = tagInfo;
        await this._emitSplitValues(length);
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
