/**
 * Issue-derived regression tests — AsyncDicomReader surface.
 *
 * #477 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/477
 *   Symptoms reported: (1) docs/AsyncDicomReader-skill.md examples call
 *   reader.stream.setData(arrayBuffer), which does not exist on
 *   ReadBufferStream (workaround: addBuffer + setComplete) — pinned as a
 *   KNOWN GAP below; (2) the PixelData element was said to be wrongly
 *   nested. Observed in 1.0: the PixelData element sits at the dataset
 *   TOP level (dict["7FE00010"]); its Value is an array of frames where
 *   each frame is an array of chunks — that frame nesting is the
 *   documented streaming contract (see test/async-data.test.js "async
 *   reader listen test uncompressed"), not a placement bug.
 *
 * #478 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/478
 *   Symptoms reported: read({ untilTag }) crashes ("this.current is
 *   null") when the docs pattern is followed, because the docs omit the
 *   required listener.startObject() before read() and add a stray
 *   listener.pop() after. With the corrected invocation (pinned here),
 *   includeUntilTagValue: false stops BEFORE the untilTag and
 *   includeUntilTagValue: true includes it; neither crashes. Note: the
 *   option is named includeUntilTagValue (the issue title says
 *   includeUntilTag), and with includeUntilTagValue: true the async
 *   reader currently continues to end-of-stream rather than stopping
 *   just after the untilTag (divergence from DicomMessage._read noted
 *   here for the record; the inclusion contract itself holds).
 *
 * #479 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/479
 *   Symptom: AsyncDicomReader.readSingle() discards the rawValue that
 *   ValueRepresentation.read() returns, while the eager
 *   DicomMessage._readTag stores it as _rawValue — so formatting
 *   (e.g. DS "1.5000") is lost when writing an async-read dataset back.
 *   Observed in 1.0: still discarded — KNOWN GAP below.
 *
 * References: src/AsyncDicomReader.js, docs/AsyncDicomReader-skill.md,
 * src/utilities/DicomMetadataListener.js.
 */
import dcmjs from "../../src/index.js";
import {
    createSampleDicom,
    defaultImage
} from "../helper/sampleDicomPart10.js";
import { TagHex } from "../../src/constants/dicom.js";

const { DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;
const { DicomMetadataListener } = dcmjs.utilities;

const DS_TAG = "00180050"; // SliceThickness
const DS_RAW = "1.5000";

function sampleBuffer() {
    return createSampleDicom({
        dict: { [DS_TAG]: { vr: "DS", Value: [DS_RAW] } }
    });
}

/** Feed a complete ArrayBuffer to a new reader (docs' setData workaround). */
function makeReader(buffer) {
    const reader = new AsyncDicomReader();
    reader.stream.addBuffer(buffer);
    reader.stream.setComplete();
    return reader;
}

describe("issue #477 — readFile places PixelData at the dataset top level", () => {
    it("PixelData is a top-level element, not nested inside another element", async () => {
        const reader = makeReader(sampleBuffer());
        const { dict } = await reader.readFile();

        // Top-level placement
        expect(Object.keys(dict)).toContain(TagHex.PixelData);
        expect(dict[TagHex.PixelData].vr).toBe("OB");

        // Not nested: no OTHER top-level element contains a 7FE00010 key
        for (const tag of Object.keys(dict)) {
            if (tag === TagHex.PixelData) continue;
            const value = dict[tag].Value;
            const json = JSON.stringify(value, (k, v) =>
                v instanceof ArrayBuffer ? "<binary>" : v
            );
            expect(json).not.toContain("7FE00010");
        }

        // Frame nesting is the documented streaming contract: an array of
        // frames, each an array of chunk ArrayBuffers (pinned by
        // test/async-data.test.js as well).
        const frames = dict[TagHex.PixelData].Value;
        expect(frames.length).toBe(defaultImage.numberOfFrames);
        for (const frame of frames) {
            expect(Array.isArray(frame)).toBe(true);
            const bytes = frame.reduce((n, chunk) => n + chunk.byteLength, 0);
            expect(bytes).toBe(defaultImage.frameBytes);
        }
    });

    // KNOWN GAP: observed — reader.stream.setData is undefined
    // (ReadBufferStream has addBuffer/setComplete instead), while
    // docs/AsyncDicomReader-skill.md calls reader.stream.setData(...) in
    // every example; expected the documented API to exist (or the docs
    // to match the implementation).
    it.skip("KNOWN GAP #477: docs reference reader.stream.setData(), which does not exist", () => {
        const reader = new AsyncDicomReader();
        expect(typeof reader.stream.setData).toBe("function");
    });
});

describe("issue #478 — read({ untilTag }) honors the flag without crashing", () => {
    async function readUntil(includeUntilTagValue) {
        const reader = makeReader(createSampleDicom());
        await reader.readPreamble();
        await reader.readMeta();
        // Corrected invocation from the issue: startObject() before
        // read(), and no extra pop() afterwards.
        const listener = new DicomMetadataListener();
        listener.startObject({});
        return reader.read(listener, {
            untilTag: TagHex.Rows,
            includeUntilTagValue
        });
    }

    it("includeUntilTagValue: false stops BEFORE Rows (00280010)", async () => {
        const result = await readUntil(false);
        expect(result[TagHex.Rows]).toBeUndefined();
        // Elements preceding Rows in tag order were read
        expect(result["00280002"].Value).toEqual([1]); // SamplesPerPixel
        // NumberOfFrames (IS) is delivered formatted as a Number here
        expect(result["00280008"].Value).toEqual([3]);
        // Nothing after the boundary leaked in
        expect(result[TagHex.PixelData]).toBeUndefined();
    });

    it("includeUntilTagValue: true includes Rows and does not crash", async () => {
        const result = await readUntil(true);
        expect(result[TagHex.Rows].Value).toEqual([defaultImage.rows]);
        expect(result["00280002"].Value).toEqual([1]);
    });
});

describe("issue #479 — rawValue retention after async read", () => {
    // KNOWN GAP: observed — the async dict entry for a DS element is
    // { vr: "DS", Value: [1.5] } with NO _rawValue, because
    // AsyncDicomReader.readSingle() drops the rawValue returned by
    // ValueRepresentation.read(); the eager DicomMessage.readFile entry
    // for the same bytes is { vr: "DS", Value: [1.5],
    // _rawValue: ["1.5000"] } (stored by DicomMessage._readTag), and the
    // raw string is what preserves formatting on write. Expected the
    // async reader to retain the raw value equivalently.
    it.skip("KNOWN GAP #479: async read discards the DS raw string that the eager reader retains", async () => {
        const buffer = sampleBuffer();

        const eager = DicomMessage.readFile(buffer);
        expect(eager.dict[DS_TAG]._rawValue).toEqual([DS_RAW]);

        const reader = makeReader(buffer);
        const { dict } = await reader.readFile();
        expect(dict[DS_TAG].Value).toEqual([1.5]);
        expect(dict[DS_TAG]._rawValue).toEqual(eager.dict[DS_TAG]._rawValue);
    });

    it("async and eager readers agree on the formatted DS value", async () => {
        const buffer = sampleBuffer();
        const eager = DicomMessage.readFile(buffer);
        const { dict } = await makeReader(buffer).readFile();
        expect(dict[DS_TAG].Value).toEqual(eager.dict[DS_TAG].Value);
        expect(dict[DS_TAG].vr).toBe("DS");
    });
});
