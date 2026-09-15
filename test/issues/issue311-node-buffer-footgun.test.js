/**
 * Issue #311 — "Trouble doing basic loading" (+ #370 duplicate:
 * "modifying dicom meta-data")
 * https://github.com/dcmjs-org/dcmjs/issues/311
 * https://github.com/dcmjs-org/dcmjs/issues/370
 *
 * Symptom: Node users pass `fs.readFile` output (a Buffer — i.e. a
 * Uint8Array VIEW into a shared allocation pool, usually at a nonzero
 * byteOffset) or `fs.readFileSync(path).buffer` (the WHOLE pool) to
 * DicomMessage.readFile. Pre-1.0 this crashed with "First argument to
 * DataView constructor must be an ArrayBuffer" for some files and not
 * others — the classic pooled-Buffer footgun: whether it "works" depends
 * on where in the pool the bytes happen to sit.
 *
 * Triage: C — contract assertion, fs-free simulation: a large
 * ArrayBuffer pool with valid Part 10 bytes copied to a nonzero offset,
 * and a Uint8Array view over exactly those bytes handed to readFile.
 *
 * 1.0 contract (fixed in this arc): views are handled correctly —
 * SplitDataView.addBuffer honors typed-array view boundaries
 * (byteOffset/byteLength), so parsing a view equals parsing
 * view.buffer.slice(byteOffset, byteOffset + byteLength). Pooled Node
 * Buffers at any byteOffset parse their own bytes, never the pool's.
 */

import "../../src/index.js";
import { DicomMessage } from "../../src/DicomMessage.js";
import { validationLog } from "../../src/log.js";
import {
    createSampleDicom,
    defaultImage
} from "../helper/sampleDicomPart10.js";
import { TagHex } from "../../src/constants/dicom.js";

validationLog.setLevel(5);

const FILE_A_ROWS = defaultImage.rows; // 32 (helper default)
const FILE_B_ROWS = 16;

const fileA = () => new Uint8Array(createSampleDicom());
const fileB = () =>
    new Uint8Array(
        createSampleDicom({
            dict: { [TagHex.Rows]: { vr: "US", Value: [FILE_B_ROWS] } }
        })
    );

describe("issue #311/#370 — pooled Buffer/Uint8Array views into readFile", () => {
    it("control: an exact ArrayBuffer slice parses correctly", () => {
        const bytes = fileA();
        const pool = new ArrayBuffer(bytes.length + 4096);
        new Uint8Array(pool).fill(0xab);
        new Uint8Array(pool).set(bytes, 1024);
        const slice = pool.slice(1024, 1024 + bytes.length);
        const { dict } = DicomMessage.readFile(slice);
        expect(dict[TagHex.Rows].Value).toEqual([FILE_A_ROWS]);
        expect(dict[TagHex.PixelData].Value[0].byteLength).toBe(
            defaultImage.totalPixelBytes
        );
    });

    it("pinned: a view at byteOffset 0 (pool longer than the file) parses correctly", () => {
        const bytes = fileA();
        const pool = new ArrayBuffer(bytes.length + 4096);
        new Uint8Array(pool).fill(0xab);
        new Uint8Array(pool).set(bytes, 0);
        const view = new Uint8Array(pool, 0, bytes.length);
        const { dict } = DicomMessage.readFile(view);
        expect(dict[TagHex.Rows].Value).toEqual([FILE_A_ROWS]);
    });

    it("a view at a nonzero byteOffset over junk-prefixed pool parses its own bytes", () => {
        const bytes = fileA();
        const pool = new ArrayBuffer(bytes.length + 4096);
        new Uint8Array(pool).fill(0xab); // junk outside the view window
        const offset = 1024;
        new Uint8Array(pool).set(bytes, offset);
        const view = new Uint8Array(pool, offset, bytes.length);
        // Fixed in this arc: SplitDataView.addBuffer honors the view's
        // byteOffset, so the view's own (valid) bytes parse instead of the
        // pool-prefix junk throwing a misleading header error.
        const { dict } = DicomMessage.readFile(view);
        expect(dict[TagHex.Rows].Value).toEqual([FILE_A_ROWS]);
    });

    // Fixed in this arc: SplitDataView.addBuffer keeps typed-array view
    // boundaries (byteOffset/byteLength) instead of unwrapping to the whole
    // backing pool, so parsing a pooled view equals parsing its exact slice.
    it("#311: parsing a pooled view must equal parsing its exact slice", () => {
        const a = fileA();
        const b = fileB();
        expect(a.length).toBe(b.length); // same layout, Rows differs
        const pool = new ArrayBuffer(a.length + b.length);
        new Uint8Array(pool).set(a, 0);
        new Uint8Array(pool).set(b, a.length);
        const viewOfB = new Uint8Array(pool, a.length, b.length);

        const { dict } = DicomMessage.readFile(viewOfB);
        // Must be file B (Rows 16) — observed: file A (Rows 32), silently.
        expect(dict[TagHex.Rows].Value).toEqual([FILE_B_ROWS]);

        // Full equivalence with the exact-slice parse:
        const sliceDict = DicomMessage.readFile(
            pool.slice(a.length, a.length + b.length)
        ).dict;
        expect(Object.keys(dict).sort()).toEqual(Object.keys(sliceDict).sort());
    });

    it("a pooled view no longer silently parses the preceding file's bytes", () => {
        const a = fileA();
        const b = fileB();
        const pool = new ArrayBuffer(a.length + b.length);
        new Uint8Array(pool).set(a, 0);
        new Uint8Array(pool).set(b, a.length);
        const viewOfB = new Uint8Array(pool, a.length, b.length);
        const { dict } = DicomMessage.readFile(viewOfB);
        // Fixed in this arc: previously this returned file A's dataset
        // (Rows 32) because the view's byteOffset was dropped.
        expect(dict[TagHex.Rows].Value).toEqual([FILE_B_ROWS]);
    });
});
