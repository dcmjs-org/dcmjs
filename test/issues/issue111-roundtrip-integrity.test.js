/**
 * Round-trip integrity of read -> (naturalize -> denaturalize) -> write -> read
 * on synthetic multiframe files (plain ELE and encapsulated variants).
 *
 * Upstream issues (all triage category A - synthetic reproducer):
 *
 * - #111 https://github.com/dcmjs-org/dcmjs/issues/111
 *   naturalizeDataset -> denaturalizeDataset -> write produced a broken
 *   image ("red flag" render). Pinned here as: the round trip yields a
 *   readable file whose element set and representative values (including
 *   PixelData bytes) equal the original.
 * - #115 https://github.com/dcmjs-org/dcmjs/issues/115
 *   PixelRepresentation (US, value 0 - falsy!) was dropped by the same
 *   round trip (classic falsy-value drop). Mirrors the issue's exact
 *   namifyDataset + datasetToDict flow.
 * - #95 https://github.com/dcmjs-org/dcmjs/issues/95
 *   editing header strings (same-length PHI replacement) corrupted pixel
 *   data on write. Pinned as: a same-length PatientName edit leaves the
 *   re-read PixelData byte-identical to the original.
 * - #167 https://github.com/dcmjs-org/dcmjs/issues/167
 *   repeated read -> write cycles grew the file without bound
 *   (4MB -> 6 -> 11 -> 20 -> ... -> OOM). Pinned as: output byteLength
 *   stabilizes (cycle 2 === cycle 3) for plain and encapsulated variants.
 * - #418 https://github.com/dcmjs-org/dcmjs/issues/418
 *   a zero-length element (empty ReferringPhysicianName) naturalized to
 *   undefined and was silently OMITTED on denaturalize, changing the
 *   element set across the round trip (dcmjs-dimse regression class).
 *   Pinned as: element count and tag set are preserved.
 * - #458 https://github.com/dcmjs-org/dcmjs/issues/458 (with
 *   #466 https://github.com/dcmjs-org/dcmjs/issues/466)
 *   0.45 regression: write({ allowInvalidVRLength: true }) silently lost
 *   pixel data on some files, and dcmjs output made DCMTK error out
 *   downstream. Pinned as: the encapsulated variant keeps non-empty,
 *   byte-identical PixelData through that write path, and the written
 *   output re-parses under our own STRICT reader (readFile without
 *   options) as a DCMTK stand-in.
 *
 * Related existing coverage (cited, not duplicated):
 * - test/lossless-read-write.test.js - per-VR value round trips and
 *   fragment-structure-preserving passthrough writes on fixtures.
 * - test/writer-backpatch.test.js - byte identity of the backpatch writer.
 * This file covers the naturalize/denaturalize round trip on synthetic
 * in-memory multiframes, which those suites do not.
 */

import dcmjs from "../../src/index.js";
import {
    createSampleDicom,
    defaultImage
} from "../helper/sampleDicomPart10.js";

const { DicomMessage, DicomMetaDictionary, datasetToDict } = dcmjs.data;

const JPEG_BASELINE = "1.2.840.10008.1.2.4.50";

// Three frames with distinct, position-dependent byte patterns.
function makeFrames() {
    return [1, 2, 3].map(i => {
        const bytes = new Uint8Array(defaultImage.frameBytes);
        for (let j = 0; j < bytes.length; j++) {
            bytes[j] = (i * 61 + j) & 0xff;
        }
        return bytes.buffer;
    });
}

const EXTRA_DICT = {
    "00080016": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.1"] },
    "00080018": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9"] },
    "00080020": { vr: "DA", Value: ["20200101"] },
    "00100010": { vr: "PN", Value: ["Doe^John"] },
    "00100020": { vr: "LO", Value: ["PID12345"] },
    "0020000D": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9.10"] },
    "0020000E": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9.11"] }
};

function makePlainBuffer(extraDict = {}) {
    return createSampleDicom(
        { dict: { ...EXTRA_DICT, ...extraDict } },
        { pixelData: makeFrames() }
    );
}

// Basic Offset Table block: one uint32 LE offset per frame, where each
// item costs 8 header bytes + payload. Built via Uint8Array/DataView:
// in this jest environment `new Uint32Array(...).buffer instanceof
// ArrayBuffer` is false (realm quirk) and the sample helper would then
// silently skip the block's bytes.
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

function makeEncapsulatedBuffer(extraDict = {}, frames = makeFrames()) {
    // First item: Basic Offset Table; then one item (= one fragment
    // = one frame) per frame.
    return createSampleDicom(
        {
            meta: {
                "00020010": { vr: "UI", Value: [JPEG_BASELINE] }
            },
            dict: { ...EXTRA_DICT, ...extraDict }
        },
        {
            pixelData: [makeBotBlock(frames), ...frames],
            pixelDataLength: -1
        }
    );
}

function bytesOf(value) {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function concatValues(values) {
    const parts = values.map(bytesOf);
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    parts.reduce((offset, p) => {
        out.set(p, offset);
        return offset + p.length;
    }, 0);
    return out;
}

function expectSamePixelBytes(entryA, entryB) {
    const a = concatValues(entryA.Value);
    const b = concatValues(entryB.Value);
    expect(b.length).toBe(a.length);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
}

// Normalizes dict-entry values for cross-read comparison: PN objects to
// their part10 string, String boxes to primitives, numbers to numbers.
function normalizeValue(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeValue);
    }
    if (value instanceof String) {
        return String(value);
    }
    if (value && typeof value === "object" && !(value instanceof ArrayBuffer)) {
        if (value.Alphabetic !== undefined) {
            return String(value.Alphabetic);
        }
    }
    return value;
}

function naturalizeDenaturalizeRoundTrip(buffer) {
    const dicomDict = DicomMessage.readFile(buffer);
    const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
    dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
    const outBuffer = dicomDict.write();
    return { outBuffer, reRead: DicomMessage.readFile(outBuffer) };
}

describe("issue #111 - naturalize/denaturalize/write round trip stays valid and equal", () => {
    it("plain multiframe: re-read succeeds with equal tag set and representative values", () => {
        const buffer = makePlainBuffer();
        const original = DicomMessage.readFile(buffer);
        const { reRead } = naturalizeDenaturalizeRoundTrip(buffer);

        expect(Object.keys(reRead.dict).sort()).toEqual(
            Object.keys(original.dict).sort()
        );

        const representative = [
            "00080016",
            "00080018",
            "00080020",
            "00100010",
            "00100020",
            "0020000D",
            "0020000E",
            "00280002",
            "00280008",
            "00280010",
            "00280011",
            "00280100",
            "00280103"
        ];
        for (const tag of representative) {
            expect(normalizeValue(reRead.dict[tag].Value)).toEqual(
                normalizeValue(original.dict[tag].Value)
            );
        }
        expectSamePixelBytes(
            reRead.dict["7FE00010"],
            original.dict["7FE00010"]
        );
    });

    it("encapsulated multiframe: re-read succeeds with equal tag set and frame bytes", () => {
        const buffer = makeEncapsulatedBuffer();
        const original = DicomMessage.readFile(buffer);
        const { reRead } = naturalizeDenaturalizeRoundTrip(buffer);

        expect(Object.keys(reRead.dict).sort()).toEqual(
            Object.keys(original.dict).sort()
        );
        expect(reRead.dict["7FE00010"].Value.length).toBe(
            defaultImage.numberOfFrames
        );
        expectSamePixelBytes(
            reRead.dict["7FE00010"],
            original.dict["7FE00010"]
        );
    });
});

describe("issue #115 - PixelRepresentation US value 0 survives the round trip", () => {
    it("keeps (0028,0103) with value 0 through readFile -> naturalize -> datasetToDict -> write -> readFile", () => {
        // Mirrors the issue's reported flow verbatim (namifyDataset + datasetToDict).
        const buffer = makePlainBuffer();
        let dicomDict = DicomMessage.readFile(buffer);
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        dataset._meta = DicomMetaDictionary.namifyDataset(dicomDict.meta);
        expect(dataset.PixelRepresentation).toBe(0);

        dicomDict = datasetToDict(dataset);
        const outBuffer = dicomDict.write();

        const reRead = DicomMessage.readFile(outBuffer);
        expect(reRead.dict["00280103"]).toBeDefined();
        expect(normalizeValue(reRead.dict["00280103"].Value)).toEqual([0]);
        const dataset2 = DicomMetaDictionary.naturalizeDataset(reRead.dict);
        expect(dataset2.PixelRepresentation).toBe(0);
    });
});

describe("issue #95 - same-length header edit leaves pixel bytes intact", () => {
    it("PatientName edit (same length) then write: PixelData byte-identical to the original", () => {
        const frames = makeFrames();
        const buffer = createSampleDicom(
            { dict: EXTRA_DICT },
            { pixelData: frames }
        );
        const original = DicomMessage.readFile(buffer);

        const dicomDict = DicomMessage.readFile(buffer);
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        // "Doe^John" -> "Foe^John": identical byte length, PHI-style edit
        dataset.PatientName = "Foe^John";
        dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
        const outBuffer = dicomDict.write();

        const reRead = DicomMessage.readFile(outBuffer);
        expect(normalizeValue(reRead.dict["00100010"].Value[0])).toBe(
            "Foe^John"
        );
        expectSamePixelBytes(
            reRead.dict["7FE00010"],
            original.dict["7FE00010"]
        );
        // and against the raw source frames
        const expected = concatValues(frames);
        const actual = concatValues(reRead.dict["7FE00010"].Value);
        expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
    });
});

describe("issue #167 - repeated read/write cycles do not grow the file", () => {
    function cycleSizes(buffer, cycles = 3) {
        const sizes = [];
        let current = buffer;
        for (let i = 0; i < cycles; i++) {
            const dicomDict = DicomMessage.readFile(current);
            current = dicomDict.write();
            sizes.push(current.byteLength);
        }
        return sizes;
    }

    it("plain multiframe: output size stabilizes (cycle 2 === cycle 3)", () => {
        const buffer = makePlainBuffer();
        const sizes = cycleSizes(buffer);
        expect(sizes[1]).toBe(sizes[2]);
        // no unbounded growth: even cycle 3 stays within 2x the source
        expect(sizes[2]).toBeLessThan(buffer.byteLength * 2);
    });

    it("encapsulated multiframe: output size stabilizes (cycle 2 === cycle 3)", () => {
        const buffer = makeEncapsulatedBuffer();
        const sizes = cycleSizes(buffer);
        expect(sizes[1]).toBe(sizes[2]);
        expect(sizes[2]).toBeLessThan(buffer.byteLength * 2);
    });
});

describe("issue #418 - element count and tag set preserved across the round trip", () => {
    // The upstream fixture's trigger was a ZERO-LENGTH element (empty
    // Referring Physician Name) that naturalized to undefined and was
    // omitted on denaturalize. Same trigger, synthetic.
    const EMPTY_ELEMENT = { "00080090": { vr: "PN", Value: [] } };

    it("plain variant: tag set (including the empty element) survives", () => {
        const buffer = makePlainBuffer(EMPTY_ELEMENT);
        const original = DicomMessage.readFile(buffer);
        expect(Object.keys(original.dict)).toContain("00080090");

        const { reRead } = naturalizeDenaturalizeRoundTrip(buffer);
        expect(Object.keys(reRead.dict).length).toBe(
            Object.keys(original.dict).length
        );
        expect(Object.keys(reRead.dict).sort()).toEqual(
            Object.keys(original.dict).sort()
        );
    });

    it("encapsulated variant: tag set (including the empty element) survives", () => {
        const buffer = makeEncapsulatedBuffer(EMPTY_ELEMENT);
        const original = DicomMessage.readFile(buffer);
        expect(Object.keys(original.dict)).toContain("00080090");

        const { reRead } = naturalizeDenaturalizeRoundTrip(buffer);
        expect(Object.keys(reRead.dict).length).toBe(
            Object.keys(original.dict).length
        );
        expect(Object.keys(reRead.dict).sort()).toEqual(
            Object.keys(original.dict).sort()
        );
    });
});

describe("issues #458/#466 - allowInvalidVRLength write keeps pixel data and stays strictly parseable", () => {
    it("encapsulated variant: write({allowInvalidVRLength:true}) keeps non-empty PixelData and strict re-parse succeeds", () => {
        const buffer = makeEncapsulatedBuffer();
        const original = DicomMessage.readFile(buffer);

        const dicomDict = DicomMessage.readFile(buffer);
        const outBuffer = dicomDict.write({ allowInvalidVRLength: true });

        // #458: pixel data must never be silently lost
        const reRead = DicomMessage.readFile(outBuffer, {
            ignoreErrors: false
        });
        const pixelEntry = reRead.dict["7FE00010"];
        expect(pixelEntry).toBeDefined();
        expect(pixelEntry.Value.length).toBe(defaultImage.numberOfFrames);
        for (const frame of pixelEntry.Value) {
            expect(frame.byteLength).toBeGreaterThan(0);
        }
        expectSamePixelBytes(pixelEntry, original.dict["7FE00010"]);

        // #466: strict re-parse of the written output (no lenient options)
        // as our stand-in for DCMTK accepting the file.
        expect(() => DicomMessage.readFile(outBuffer)).not.toThrow();
    });
});
