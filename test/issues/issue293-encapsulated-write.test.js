/**
 * Encapsulated pixel data and sequence writing behavior.
 *
 * Upstream issues:
 * - #293 https://github.com/dcmjs-org/dcmjs/issues/293 (A)
 *   Odd-length encapsulated frames: the pad byte was written once at the
 *   END of the whole OB tag instead of per frame. pydicom parity requires
 *   each frame's FINAL fragment to be padded to even length.
 * - #159 https://github.com/dcmjs-org/dcmjs/issues/159 (A)
 *   writeBytes froze the browser on encapsulated files with many frames
 *   (117 MB / 120 frames): per-fragment concatenation was quadratic.
 *   Pinned as: 120 frames x 64 KB completes well under the test timeout
 *   with output size ~= payload + item headers.
 * - #340 https://github.com/dcmjs-org/dcmjs/issues/340 (A)
 *   RLE Lossless (1.2.840.10008.1.2.5) requires ONE fragment per frame
 *   (PS3.5 Annex G); the default fragmentMultiframe:true re-fragmented
 *   frames > 20 KB, corrupting US cine loops for dcm4che/DCMTK.
 * - #161 https://github.com/dcmjs-org/dcmjs/issues/161 (A)
 *   DicomDict.write threw "Cannot read property 'fragmentMultiframe' of
 *   undefined" when an OW element sat inside a SQ item (writeOptions were
 *   not forwarded to nested writes).
 * - #90 https://github.com/dcmjs-org/dcmjs/issues/90 (C - contract)
 *   A defined-length SQ input (length 152) was rewritten with undefined
 *   length (-1). That is LEGAL per PS3.5 7.5. 1.0 contract asserted here:
 *   the eager writer re-encodes SQs with UNDEFINED length; the round trip
 *   is semantically equal and re-readable. Byte-identity of the SQ length
 *   encoding is a NON-GOAL of the eager writer (the deprecated lazy core's
 *   passthrough path preserved source bytes - see
 *   test/write-passthrough.test.js and the lazy pin in
 *   test/data.test.js "test_invalid_vr_length"); the defined-length READ
 *   side is covered by test/defined-length-sequence.test.js.
 *
 * Structural assertions parse the writer's output bytes with the
 * independent walker in test/issues/part10Walker.js (pydicom/DCMTK
 * stand-in), not the library's own reader.
 */

import dcmjs from "../../src/index.js";
import { WriteBufferStream } from "../../src/BufferStream.js";
import { TagHex, UNDEFINED_LENGTH } from "../../src/constants/dicom.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";
import { findElement, parseEncapsulatedPixelData } from "./part10Walker.js";

const { DicomMessage } = dcmjs.data;

const EXPLICIT_LE = "1.2.840.10008.1.2.1";
const JPEG_BASELINE = "1.2.840.10008.1.2.4.50";
const RLE_LOSSLESS = "1.2.840.10008.1.2.5";
const WRITER_FRAGMENT_SIZE = 1024 * 20; // src/ValueRepresentation.js BinaryRepresentation

function makeFrames(count, byteLength) {
    return Array.from({ length: count }, (_, i) => {
        const bytes = new Uint8Array(byteLength);
        for (let j = 0; j < bytes.length; j++) {
            bytes[j] = (i * 61 + j) & 0xff;
        }
        return bytes.buffer;
    });
}

// BOT built with Uint8Array/DataView (Uint32Array.buffer fails an
// instanceof ArrayBuffer check in this jest realm).
function makeBotBlock(frames) {
    const bytes = new Uint8Array(frames.length * 4);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    frames.forEach((frame, i) => {
        view.setUint32(i * 4, offset, true);
        offset += 8 + frame.byteLength;
    });
    return bytes.buffer;
}

function makeEncapsulatedDicomDict(transferSyntax, frames) {
    const buffer = createSampleDicom(
        {
            meta: {
                [TagHex.TransferSyntaxUID]: {
                    vr: "UI",
                    Value: [transferSyntax]
                }
            },
            dict: {
                [TagHex.NumberOfFrames]: {
                    vr: "IS",
                    Value: [String(frames.length)]
                }
            }
        },
        { pixelData: [makeBotBlock(frames), ...frames], pixelDataLength: -1 }
    );
    return DicomMessage.readFile(buffer);
}

describe("issue #293 - odd-length encapsulated frames pad per frame, not at tag end", () => {
    it("each frame's final fragment is even-length with the pad byte inside that fragment", () => {
        const oddLength = 2047;
        const frames = makeFrames(3, oddLength);
        const dicomDict = makeEncapsulatedDicomDict(JPEG_BASELINE, frames);
        // Feed the writer odd-length frames directly (the read merges the
        // input's even items; replace with pristine odd buffers).
        dicomDict.dict["7FE00010"].Value = frames;

        const outBuffer = dicomDict.write();
        const { botEntryCount, fragments } =
            parseEncapsulatedPixelData(outBuffer);

        expect(botEntryCount).toBe(3);
        expect(fragments.length).toBe(3);
        fragments.forEach((fragment, i) => {
            // pydicom parity: every fragment even, pad byte INSIDE the
            // frame's final fragment - not a single pad at the tag end.
            expect(fragment.length % 2).toBe(0);
            expect(fragment.length).toBe(oddLength + 1);
            expect(fragment.bytes[oddLength]).toBe(0); // OB pad byte
            // payload intact before the pad
            const expected = new Uint8Array(frames[i]);
            expect(
                Buffer.from(fragment.bytes.subarray(0, oddLength)).equals(
                    Buffer.from(expected)
                )
            ).toBe(true);
        });
    });
});

describe("issue #159 - many-frame encapsulated write completes without quadratic blowup", () => {
    it("120 frames x 64 KB writes in bounded time and size", () => {
        const frameCount = 120;
        const frameBytes = 64 * 1024;
        const frames = makeFrames(frameCount, frameBytes);
        const payload = frameCount * frameBytes;

        const dicomDict = makeEncapsulatedDicomDict(JPEG_BASELINE, frames);

        const started = Date.now();
        const outBuffer = dicomDict.write();
        const elapsedMs = Date.now() - started;

        // Upstream this froze the tab; generous wall-clock bound.
        expect(elapsedMs).toBeLessThan(20000);

        // Output ~= payload + headers: BOT (120*4 + 8) + fragment headers
        // (120 frames x ceil(64K/20K)=4 fragments x 8 bytes) + preamble,
        // meta and the small dataset. No quadratic/duplicated payload.
        expect(outBuffer.byteLength).toBeGreaterThanOrEqual(payload);
        expect(outBuffer.byteLength).toBeLessThan(payload + 64 * 1024);

        // and the data survives
        const reRead = DicomMessage.readFile(outBuffer);
        expect(reRead.dict["7FE00010"].Value.length).toBe(frameCount);
    });
});

describe("issue #340 - RLE Lossless frames must stay one fragment per frame", () => {
    // KNOWN GAP: observed - BinaryRepresentation.writeBytes re-fragments
    // every frame larger than 20 KB regardless of transfer syntax
    // (src/ValueRepresentation.js, fragmentSize = 1024*20, no RLE check),
    // so 3 x 30 KB RLE frames emit 6 fragments. Expected - PS3.5 Annex G:
    // RLE Lossless requires exactly one fragment per frame, so the write
    // must emit 3 fragments (dcm4che logs "RLE Segment too short" and
    // DCMTK produces corrupted cine loops otherwise).
    it.skip("KNOWN GAP #340: default write re-fragments >20KB RLE frames instead of preserving one fragment per frame", () => {
        const frameBytes = 30 * 1024; // > writer fragment size to provoke re-fragmentation
        const frames = makeFrames(3, frameBytes);
        expect(frameBytes).toBeGreaterThan(WRITER_FRAGMENT_SIZE);

        // Input file: RLE Lossless, one fragment per frame (as required).
        const dicomDict = makeEncapsulatedDicomDict(RLE_LOSSLESS, frames);
        expect(dicomDict.dict["7FE00010"].Value.length).toBe(3);

        // fragmentMultiframe defaults to true - the issue's trigger.
        const outBuffer = dicomDict.write();
        const { fragments } = parseEncapsulatedPixelData(outBuffer);

        // RLE: fragment count in output === frame count.
        expect(fragments.length).toBe(3);
        fragments.forEach(fragment => {
            expect(fragment.length).toBe(frameBytes);
        });
    });

    it("write({fragmentMultiframe:false}) preserves one fragment per frame (workaround contract)", () => {
        const frameBytes = 30 * 1024;
        const frames = makeFrames(3, frameBytes);
        const dicomDict = makeEncapsulatedDicomDict(RLE_LOSSLESS, frames);

        const outBuffer = dicomDict.write({ fragmentMultiframe: false });
        const { fragments } = parseEncapsulatedPixelData(outBuffer);

        expect(fragments.length).toBe(3);
        fragments.forEach((fragment, i) => {
            expect(fragment.length).toBe(frameBytes);
            expect(
                Buffer.from(fragment.bytes).equals(
                    Buffer.from(new Uint8Array(frames[i]))
                )
            ).toBe(true);
        });
    });
});

describe("issue #161 - OW element inside a SQ item writes and round-trips", () => {
    it("write() with default options succeeds and the nested OW bytes survive", () => {
        const dicomDict = DicomMessage.readFile(createSampleDicom());

        const owBytes = new Uint8Array(64);
        for (let i = 0; i < owBytes.length; i++) {
            owBytes[i] = (i * 7) & 0xff;
        }
        // Same dict item shape as test/lossless-read-write.test.js SQ datasets.
        dicomDict.dict["00081140"] = {
            vr: "SQ",
            Value: [
                {
                    60003000: { vr: "OW", Value: [owBytes.buffer] }
                }
            ]
        };

        // Upstream: TypeError "Cannot read property 'fragmentMultiframe'
        // of undefined" from the nested OW write.
        let outBuffer;
        expect(() => {
            outBuffer = dicomDict.write();
        }).not.toThrow();

        const reRead = DicomMessage.readFile(outBuffer);
        const item = reRead.dict["00081140"].Value[0];
        expect(item["60003000"]).toBeDefined();
        expect(item["60003000"].vr).toBe("OW");
        const roundTripped = new Uint8Array(item["60003000"].Value[0]);
        expect(Buffer.from(roundTripped).equals(Buffer.from(owBytes))).toBe(
            true
        );
    });
});

describe("issue #90 - defined-length SQ is legally rewritten with undefined length", () => {
    /**
     * Hand-builds a Part 10 buffer whose SQ (0040,A730) uses DEFINED
     * lengths for the sequence and its items (the built-in SQ writer
     * always emits undefined lengths, so this must be manual - same
     * technique as test/defined-length-sequence.test.js).
     */
    function buildDefinedLengthSQBuffer(itemCodeValues) {
        const metaBody = new WriteBufferStream(256, true);
        DicomMessage.writeTagObject(
            metaBody,
            TagHex.TransferSyntaxUID,
            "UI",
            [EXPLICIT_LE],
            EXPLICIT_LE,
            {}
        );

        const seqBody = new WriteBufferStream(1024, true);
        for (const val of itemCodeValues) {
            const itemBody = new WriteBufferStream(256, true);
            DicomMessage.writeTagObject(
                itemBody,
                "00080100",
                "SH",
                [val],
                EXPLICIT_LE,
                {}
            );
            seqBody.writeUint16(0xfffe);
            seqBody.writeUint16(0xe000);
            seqBody.writeUint32(itemBody.size); // DEFINED item length
            seqBody.concat(itemBody);
        }

        const file = new WriteBufferStream(4096, true);
        file.writeUint8Repeat(0, 128);
        file.writeAsciiString("DICM");
        DicomMessage.writeTagObject(
            file,
            TagHex.FileMetaInformationGroupLength,
            "UL",
            metaBody.size,
            EXPLICIT_LE,
            {}
        );
        file.concat(metaBody);

        // SQ header with DEFINED length (tag + "SQ" + reserved + uint32)
        file.writeUint16(0x0040);
        file.writeUint16(0xa730);
        file.writeAsciiString("SQ");
        file.writeUint16(0);
        file.writeUint32(seqBody.size);
        file.concat(seqBody);
        return file.getBuffer();
    }

    it("round trip is semantically equal and re-readable; output SQ length is undefined (contract)", () => {
        const inputBuffer = buildDefinedLengthSQBuffer(["CODE_A", "CODE_B"]);

        // sanity: the input really carries a defined length
        const inputSq = findElement(inputBuffer, "0040A730");
        expect(inputSq.vr).toBe("SQ");
        expect(inputSq.length).not.toBe(UNDEFINED_LENGTH);

        const dicomDict = DicomMessage.readFile(inputBuffer);
        expect(dicomDict.dict["0040A730"].Value.length).toBe(2);

        const outBuffer = dicomDict.write();

        // 1.0 contract: the eager writer re-encodes SQ with undefined
        // length (legal per PS3.5 7.5); byte-identity of the length
        // encoding is a documented non-goal.
        const outputSq = findElement(outBuffer, "0040A730");
        expect(outputSq.vr).toBe("SQ");
        expect(outputSq.length).toBe(UNDEFINED_LENGTH);

        // semantic equality + re-readability
        const reRead = DicomMessage.readFile(outBuffer);
        const items = reRead.dict["0040A730"].Value;
        expect(items.length).toBe(2);
        expect(String(items[0]["00080100"].Value[0])).toBe("CODE_A");
        expect(String(items[1]["00080100"].Value[0])).toBe("CODE_B");
    });
});
