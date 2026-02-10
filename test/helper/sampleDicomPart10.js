/**
 * Helper to create in-memory DICOM Part 10 test data: natural format image
 * (3 frames, 64x32, 8-bit grayscale) with optional overrides and custom pixel data.
 * Provides strip methods for preamble, meta length, or up to dataset start.
 */

import { WriteBufferStream } from "../../src/BufferStream.js";
import { TagHex, UNDEFINED_LENGTH } from "../../src/constants/dicom.js";
import { DicomMessage } from "../../src/DicomMessage.js";

const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";

// Default: 3 frames, 64x32, 8-bit grayscale. Frame bytes = 64*32 = 2048, total = 6144.
const DEFAULT_ROWS = 32;
const DEFAULT_COLUMNS = 64;
const DEFAULT_FRAMES = 3;
const DEFAULT_BITS = 8;
const DEFAULT_SAMPLES = 1;
const FRAME_BYTES = DEFAULT_COLUMNS * DEFAULT_ROWS * DEFAULT_SAMPLES;
const DEFAULT_PIXEL_BYTES = FRAME_BYTES * DEFAULT_FRAMES;

const defaultMeta = {
    [TagHex.TransferSyntaxUID]: {
        vr: "UI",
        Value: [EXPLICIT_LITTLE_ENDIAN]
    },
    [TagHex.MediaStorageSOPInstanceUID]: {
        vr: "UI",
        Value: ["1.2.3.4.5.6.7.8.9"]
    },
    [TagHex.MediaStorageSOPClassUID]: {
        vr: "UI",
        Value: ["1.2.840.10008.5.1.4.1.1.1"]
    }
};

const defaultDict = {
    [TagHex.Rows]: { vr: "US", Value: [DEFAULT_ROWS] },
    [TagHex.Columns]: { vr: "US", Value: [DEFAULT_COLUMNS] },
    [TagHex.SamplesPerPixel]: { vr: "US", Value: [DEFAULT_SAMPLES] },
    [TagHex.BitsAllocated]: { vr: "US", Value: [DEFAULT_BITS] },
    [TagHex.NumberOfFrames]: { vr: "IS", Value: [String(DEFAULT_FRAMES)] },
    [TagHex.PixelRepresentation]: { vr: "US", Value: [0] },
    [TagHex.PixelData]: {
        vr: "OB",
        Value: [new ArrayBuffer(DEFAULT_PIXEL_BYTES)]
    }
};

function deepMerge(target, source) {
    const out = { ...target };
    for (const key of Object.keys(source)) {
        if (
            source[key] &&
            typeof source[key] === "object" &&
            !Array.isArray(source[key]) &&
            !(source[key] instanceof ArrayBuffer)
        ) {
            out[key] = deepMerge(out[key] || {}, source[key]);
        } else {
            out[key] = source[key];
        }
    }
    return out;
}

/**
 * Write Pixel Data (7FE0,0010) with optional custom data.
 * @param {WriteBufferStream} stream - little-endian write stream
 * @param {number} pixelDataLength - total length in bytes, or -1 for undefined length (encapsulated)
 * @param {ArrayBuffer[]} [pixelDataBlocks] - optional array of blocks; if length is -1, one Item per block + end sequence
 */
function writePixelDataElement(stream, pixelDataLength, pixelDataBlocks) {
    const isLittleEndian = true;
    stream.setEndian?.(isLittleEndian);
    // Tag (7FE0,0010)
    stream.writeUint16(0x7fe0);
    stream.writeUint16(0x0010);
    stream.writeAsciiString("OB");
    stream.writeUint16(0); // reserved

    if (pixelDataLength === -1) {
        stream.writeUint32(UNDEFINED_LENGTH);
        const blocks = pixelDataBlocks || [];
        for (const block of blocks) {
            const len = block.byteLength || block.length;
            stream.writeUint16(0xfffe);
            stream.writeUint16(0xe000);
            stream.writeUint32(len);
            const arr =
                block instanceof ArrayBuffer ? new Uint8Array(block) : block;
            for (let i = 0; i < arr.length; i++) {
                stream.writeUint8(arr[i]);
            }
        }
        stream.writeUint16(0xfffe);
        stream.writeUint16(0xe0dd);
        stream.writeUint32(0);
        return;
    }

    stream.writeUint32(pixelDataLength);
    if (pixelDataBlocks && pixelDataBlocks.length) {
        for (const block of pixelDataBlocks) {
            const arr =
                block instanceof ArrayBuffer ? new Uint8Array(block) : block;
            for (let i = 0; i < arr.length; i++) {
                stream.writeUint8(arr[i]);
            }
        }
    }
}

/**
 * Combine default image dataset with updates and write to DICOM Part 10.
 * @param {Object} [updates] - overrides for meta and/or dict (e.g. { dict: { [TagHex.NumberOfFrames]: { vr: "IS", Value: ["5"] } } })
 * @param {Object} [writeOptions] - { pixelData: ArrayBuffer[], pixelDataLength: number | -1 }
 * @returns {ArrayBuffer} Part 10 buffer
 */
export function createSampleDicom(updates = {}, writeOptions = {}) {
    const meta = deepMerge(defaultMeta, updates.meta || {});
    const dict = deepMerge(defaultDict, updates.dict || {});

    const { pixelData, pixelDataLength } = writeOptions;
    const useCustomPixelData =
        pixelData !== undefined || pixelDataLength !== undefined;

    const metaStream = new WriteBufferStream(1024, true);
    if (!meta[TagHex.TransferSyntaxUID]) {
        meta[TagHex.TransferSyntaxUID] = {
            vr: "UI",
            Value: [EXPLICIT_LITTLE_ENDIAN]
        };
    }
    DicomMessage.write(meta, metaStream, EXPLICIT_LITTLE_ENDIAN, {
        allowInvalidVRLength: false
    });

    const fileStream = new WriteBufferStream(8192, true);
    fileStream.writeUint8Repeat(0, 128);
    fileStream.writeAsciiString("DICM");
    DicomMessage.writeTagObject(
        fileStream,
        TagHex.FileMetaInformationGroupLength,
        "UL",
        metaStream.size,
        EXPLICIT_LITTLE_ENDIAN,
        {}
    );
    fileStream.concat(metaStream);

    const syntax = meta[TagHex.TransferSyntaxUID].Value[0];
    const sortedTags = Object.keys(dict).sort();

    for (const tagString of sortedTags) {
        if (tagString === TagHex.PixelData && useCustomPixelData) {
            const length =
                pixelDataLength !== undefined
                    ? pixelDataLength
                    : DEFAULT_PIXEL_BYTES;
            const blocks =
                pixelData && pixelData.length
                    ? pixelData
                    : [new ArrayBuffer(length)];
            writePixelDataElement(fileStream, length, blocks);
            continue;
        }
        const tagObj = dict[tagString];
        DicomMessage.writeTagObject(
            fileStream,
            tagString,
            tagObj.vr,
            tagObj.Value,
            syntax,
            {}
        );
    }

    return fileStream.getBuffer();
}

/**
 * Strip DICOM preamble (128 bytes + "DICM").
 * @param {ArrayBuffer} buffer - Part 10 buffer
 * @returns {ArrayBuffer}
 */
export function stripPreamble(buffer) {
    return buffer.slice(132);
}

/**
 * Strip DICOM preamble and the (0002,0000) File Meta Information Group Length element.
 * UL uses VR(2) + Length(2) + Value(4), no reserved bytes.
 * @param {ArrayBuffer} buffer - Part 10 buffer
 * @returns {ArrayBuffer}
 */
export function stripPreambleAndMetaLength(buffer) {
    return buffer.slice(132 + 4 + 2 + 2 + 4); // tag(4) + VR(2) + length(2) + value(4) = 12, so 132+12=144
}

/**
 * Strip everything up to (and excluding) the start of the dataset (first 0008xxxx tag).
 * Meta length is read from (0002,0000) value.
 * @param {ArrayBuffer|Uint8Array} buffer - Part 10 buffer (from getBuffer() or similar)
 * @returns {ArrayBuffer}
 */
export function stripUntilDataset(buffer) {
    const ab = buffer.buffer || buffer;
    const byteOffset = buffer.byteOffset || 0;
    const byteLength = buffer.byteLength ?? buffer.length;
    const view = new DataView(ab, byteOffset, byteLength);
    // (0002,0000): tag(4) + VR(2) + length(2) + value(4) = 12; value at 132+8
    const metaLength = view.getUint32(132 + 4 + 2 + 2, true); // value of (0002,0000)
    const datasetStart = 132 + 12 + metaLength; // preamble + (0002,0000) element (12) + meta
    return ab.slice(byteOffset + datasetStart, byteOffset + byteLength);
}

export const defaultImage = {
    rows: DEFAULT_ROWS,
    columns: DEFAULT_COLUMNS,
    numberOfFrames: DEFAULT_FRAMES,
    bitsAllocated: DEFAULT_BITS,
    samplesPerPixel: DEFAULT_SAMPLES,
    frameBytes: FRAME_BYTES,
    totalPixelBytes: DEFAULT_PIXEL_BYTES
};
