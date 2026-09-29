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
 * 1.0 contract: either views are handled correctly (byteOffset
 * respected — parsing the view equals parsing the exact slice) or the
 * error is corrective. Observed: SplitDataView.addBuffer does
 * `buffer = buffer.buffer || buffer`, unwrapping the view to the WHOLE
 * pool and dropping byteOffset (only byteLength is kept), so the parse
 * window is pool bytes [0, view.byteLength):
 *  - pool prefix is not a preamble → throws "Invalid DICOM file,
 *    expected header is missing" — a misleading (the view's bytes ARE a
 *    valid file), but non-silent, failure. Pinned.
 *  - pool prefix happens to BE a valid file (e.g. two files read into
 *    one pool) → readFile silently parses the WRONG file's bytes.
 *    KNOWN GAP below.
 *  - views at byteOffset 0 work by accident (window degenerates to the
 *    view's own bytes). Pinned green as the current contract.
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

    it("pinned: a view at a nonzero byteOffset over junk-prefixed pool fails loudly, not silently", () => {
        const bytes = fileA();
        const pool = new ArrayBuffer(bytes.length + 4096);
        new Uint8Array(pool).fill(0xab); // junk where the parse window starts
        const offset = 1024;
        new Uint8Array(pool).set(bytes, offset);
        const view = new Uint8Array(pool, offset, bytes.length);
        // Current shape: byteOffset is dropped, the pool prefix is not a
        // preamble, and readFile throws its header error. Misleading (the
        // view's own bytes are a perfectly valid file) but not a silent
        // garbage parse.
        expect(() => DicomMessage.readFile(view)).toThrow(
            /expected header|DICM/i
        );
    });

    // KNOWN GAP: observed — SplitDataView.addBuffer unwraps
    // `view.buffer` and drops view.byteOffset, so readFile parses pool
    // bytes [0, view.byteLength). When another valid file precedes the
    // view in the pool (two files read into one Buffer pool — routine in
    // Node), readFile(viewOfB) SILENTLY returns file A's dataset: same
    // element count, wrong data, no error. Expected — parsing a view
    // equals parsing view.buffer.slice(byteOffset, byteOffset+byteLength)
    // (or a corrective error naming the byteOffset problem).
    it.skip("KNOWN GAP #311: parsing a pooled view must equal parsing its exact slice", () => {
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

    it("documents the observed silent wrong parse (drives the gap above)", () => {
        const a = fileA();
        const b = fileB();
        const pool = new ArrayBuffer(a.length + b.length);
        new Uint8Array(pool).set(a, 0);
        new Uint8Array(pool).set(b, a.length);
        const viewOfB = new Uint8Array(pool, a.length, b.length);
        const { dict } = DicomMessage.readFile(viewOfB);
        // NOT the desired contract — this pins today's footgun so the fix
        // (flipping the skip above to green) also flips this expectation.
        expect(dict[TagHex.Rows].Value).toEqual([FILE_A_ROWS]);
    });
});
