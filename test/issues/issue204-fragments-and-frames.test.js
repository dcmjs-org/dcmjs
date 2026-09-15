/**
 * Encapsulated pixel data: fragments vs frames.
 *
 * Issue #145 — "Reading encapsulated pixel data?"
 * https://github.com/dcmjs-org/dcmjs/issues/145
 * Symptom: a multiframe US with JPEG compression (encapsulated,
 * undefined length) loaded only the FIRST frame into the dataset.
 *
 * Issue #204 — "can't read an encapsulated frame whose size is greater
 * than fragment size"
 * https://github.com/dcmjs-org/dcmjs/issues/204
 * Symptom: the writer could split one frame into multiple fragments
 * (fragmentMultiframe), but the reader assumed one fragment == one
 * frame, so a frame larger than the fragment size came back truncated.
 *
 * Issue #282 — "Bug: Fragment merging results in zero value arraybuffer"
 * https://github.com/dcmjs-org/dcmjs/issues/282
 * Symptom: a fragment-merging regression concatenated ArrayBuffers with
 * `.set` on a bare ArrayBuffer (no Uint8Array view), producing a merged
 * frame that was all zeros.
 *
 * Triage: A — synthetic reproducers via createSampleDicom with
 * writeOptions { pixelData: blocks, pixelDataLength: -1 } (one
 * undefined-length Item per block). The helper emits no Basic Offset
 * Table item on its own — the FIRST block is the BOT: a 4·N-byte block
 * is a BOT with N offsets; a zero-length first block is an empty BOT
 * (passed as `{ length: 0 }` because the helper's
 * `block.byteLength || block.length` treats an empty ArrayBuffer's 0 as
 * falsy).
 *
 * Observed 1.0 reader shape (BinaryRepresentation.readBytes, pinned
 * below): with a BOT, each offset window's fragments are MERGED into one
 * ArrayBuffer per frame (typed Uint8Array copy — #282 fixed); with an
 * empty BOT, each fragment is surfaced as its own Value entry (fragments
 * == frames assumption, which is only correct at one fragment per
 * frame — NumberOfFrames is not consulted; documented, not asserted).
 * The streaming path does NOT merge BOT windows: it surfaces raw
 * fragments, diverging from the eager reader — KNOWN GAP below.
 */

import dcmjs from "../../src/index.js";
import { DicomMessage } from "../../src/DicomMessage.js";
import { validationLog } from "../../src/log.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";
import { TagHex } from "../../src/constants/dicom.js";

validationLog.setLevel(5);

const { DicomEventStream, CollectorListener } = dcmjs.eventStream;

const JPEG_BASELINE = "1.2.840.10008.1.2.4.50";
const FRAG_BYTES = 64;
const ITEM_HEADER_BYTES = 8;

/** A fragment filled with a distinct byte pattern. */
function frag(fillByte, length = FRAG_BYTES) {
    const bytes = new Uint8Array(length);
    bytes.fill(fillByte);
    return bytes.buffer;
}

/** A Basic Offset Table block for the given frame start offsets. */
function bot(offsets) {
    const table = new Uint8Array(offsets.length * 4);
    const view = new DataView(table.buffer);
    offsets.forEach((offset, i) => view.setUint32(i * 4, offset, true));
    return table.buffer;
}

/** Empty BOT block (see docblock for why not `new ArrayBuffer(0)`). */
const EMPTY_BOT = { length: 0 };

function encapsulatedSample(pixelBlocks, numberOfFrames) {
    return createSampleDicom(
        {
            meta: {
                [TagHex.TransferSyntaxUID]: {
                    vr: "UI",
                    Value: [JPEG_BASELINE]
                }
            },
            dict: {
                [TagHex.NumberOfFrames]: {
                    vr: "IS",
                    Value: [String(numberOfFrames)]
                }
            }
        },
        { pixelData: pixelBlocks, pixelDataLength: -1 }
    );
}

function expectFilledWith(arrayBuffer, ranges) {
    const u8 = new Uint8Array(arrayBuffer);
    for (const [start, end, fillByte] of ranges) {
        for (let i = start; i < end; i++) {
            if (u8[i] !== fillByte) {
                throw new Error(
                    `byte ${i} is ${u8[i]}, expected ${fillByte} (range ${start}-${end})`
                );
            }
        }
    }
}

async function streamParse(buffer) {
    const collector = new CollectorListener();
    await DicomEventStream.fromPart10Stream(new Uint8Array(buffer)).process(
        collector
    );
    return collector.result;
}

describe("issue #145 — every encapsulated frame is surfaced, not only the first", () => {
    it("empty BOT, 3 single-fragment frames: all 3 fragments surface with intact bytes", () => {
        const buffer = encapsulatedSample(
            [EMPTY_BOT, frag(0x11), frag(0x22), frag(0x33)],
            3
        );
        const pixelData = DicomMessage.readFile(buffer).dict[TagHex.PixelData];
        expect(pixelData.vr).toBe("OB");
        expect(pixelData.Value).toHaveLength(3);
        expect(pixelData.Value.map(v => v.byteLength)).toEqual([64, 64, 64]);
        expectFilledWith(pixelData.Value[0], [[0, 64, 0x11]]);
        expectFilledWith(pixelData.Value[1], [[0, 64, 0x22]]);
        expectFilledWith(pixelData.Value[2], [[0, 64, 0x33]]);
    });

    it("BOT with 3 offsets: 3 frames, each byte-intact", () => {
        const frameStride = FRAG_BYTES + ITEM_HEADER_BYTES;
        const buffer = encapsulatedSample(
            [
                bot([0, frameStride, 2 * frameStride]),
                frag(0x11),
                frag(0x22),
                frag(0x33)
            ],
            3
        );
        const pixelData = DicomMessage.readFile(buffer).dict[TagHex.PixelData];
        expect(pixelData.Value).toHaveLength(3);
        expectFilledWith(pixelData.Value[0], [[0, 64, 0x11]]);
        expectFilledWith(pixelData.Value[1], [[0, 64, 0x22]]);
        expectFilledWith(pixelData.Value[2], [[0, 64, 0x33]]);
    });
});

describe("issue #204 — frame larger than fragment size (BOT-aware merge)", () => {
    // One frame, split by the writer into two 64-byte fragments; the BOT
    // declares a single frame starting at offset 0.
    const splitFrameBuffer = () =>
        encapsulatedSample([bot([0]), frag(0xaa), frag(0xbb)], 1);

    it("eager: the two fragments merge into one full-frame ArrayBuffer", () => {
        const pixelData = DicomMessage.readFile(splitFrameBuffer()).dict[
            TagHex.PixelData
        ];
        // Shape contract: one Value entry per BOT frame, fragments merged
        // (fragment boundaries are NOT preserved on the default path).
        expect(pixelData.Value).toHaveLength(1);
        expect(pixelData.Value[0].byteLength).toBe(128);
        expectFilledWith(pixelData.Value[0], [
            [0, 64, 0xaa],
            [64, 128, 0xbb]
        ]);
    });

    it("two BOT frames of two fragments each merge per frame", () => {
        const frameStride = 2 * (FRAG_BYTES + ITEM_HEADER_BYTES);
        const buffer = encapsulatedSample(
            [
                bot([0, frameStride]),
                frag(0x0a),
                frag(0x0b),
                frag(0x0c),
                frag(0x0d)
            ],
            2
        );
        const pixelData = DicomMessage.readFile(buffer).dict[TagHex.PixelData];
        expect(pixelData.Value).toHaveLength(2);
        expect(pixelData.Value.map(v => v.byteLength)).toEqual([128, 128]);
        expectFilledWith(pixelData.Value[0], [
            [0, 64, 0x0a],
            [64, 128, 0x0b]
        ]);
        expectFilledWith(pixelData.Value[1], [
            [0, 64, 0x0c],
            [64, 128, 0x0d]
        ]);
    });

    // Fixed in this arc: the event stream still emits raw fragments (the
    // streaming contract), but the sources now surface the Basic Offset
    // Table on startBinary and CollectorListener/NaturalizedListener merge
    // fragments per BOT window at endBinary — so the final PixelData Value
    // shape matches the eager reader's one-entry-per-frame contract.
    it("#204: streaming path merges BOT-window fragments like the eager reader", async () => {
        const result = await streamParse(splitFrameBuffer());
        const pixelData = result.dict[TagHex.PixelData];
        expect(pixelData.Value).toHaveLength(1);
        expect(pixelData.Value[0].byteLength).toBe(128);
    });

    it("pinned: streaming path loses no bytes — all fragment bytes arrive intact", async () => {
        const result = await streamParse(splitFrameBuffer());
        const pixelData = result.dict[TagHex.PixelData];
        const parts = pixelData.Value.map(v =>
            v instanceof ArrayBuffer
                ? new Uint8Array(v)
                : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
        );
        const total = parts.reduce((n, p) => n + p.length, 0);
        expect(total).toBe(128);
        const merged = new Uint8Array(total);
        parts.reduce((offset, p) => {
            merged.set(p, offset);
            return offset + p.length;
        }, 0);
        expectFilledWith(merged.buffer, [
            [0, 64, 0xaa],
            [64, 128, 0xbb]
        ]);
    });
});

describe("issue #282 — fragment merge is a byte-correct typed copy", () => {
    it("merged frame is never a zero-filled buffer", () => {
        const pixelData = DicomMessage.readFile(
            encapsulatedSample([bot([0]), frag(0x5a), frag(0xa5)], 1)
        ).dict[TagHex.PixelData];
        const u8 = new Uint8Array(pixelData.Value[0]);
        expect(u8.byteLength).toBe(128);
        // The #282 regression produced all zeros; assert every byte.
        expect(u8.every(b => b === 0)).toBe(false);
        expectFilledWith(pixelData.Value[0], [
            [0, 64, 0x5a],
            [64, 128, 0xa5]
        ]);
    });
});
