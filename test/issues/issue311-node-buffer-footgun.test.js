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
 * 1.0 contract (review finding 1 of the PR #512 review map): views are
 * handled correctly — parsing a view (plain Uint8Array or Node Buffer,
 * at any byteOffset) equals parsing the exact slice
 * view.buffer.slice(byteOffset, byteOffset + byteLength). The former
 * footgun — ReadBufferStream adopting the WHOLE backing pool and either
 * dropping byteOffset (plain views) or seeding the read offset from the
 * Node-only Buffer.offset property while keeping the pool-relative
 * window — is fixed in the ReadBufferStream constructor, which now
 * adopts exactly the viewed byte range.
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

    it("a view at a nonzero byteOffset over a junk-prefixed pool parses the view's own bytes", () => {
        const bytes = fileA();
        const pool = new ArrayBuffer(bytes.length + 4096);
        new Uint8Array(pool).fill(0xab); // junk before the viewed bytes
        const offset = 1024;
        new Uint8Array(pool).set(bytes, offset);
        const view = new Uint8Array(pool, offset, bytes.length);
        // The pool prefix is junk, so any parse that leaks outside the
        // view's byte range throws the header error. The view's own bytes
        // are a valid file and must parse.
        const { dict } = DicomMessage.readFile(view);
        expect(dict[TagHex.Rows].Value).toEqual([FILE_A_ROWS]);
        expect(dict[TagHex.PixelData].Value[0].byteLength).toBe(
            defaultImage.totalPixelBytes
        );
    });

    // Closed gap #311: SplitDataView.addBuffer used to unwrap
    // `view.buffer` and drop view.byteOffset, so readFile parsed pool
    // bytes [0, view.byteLength). When another valid file precedes the
    // view in the pool (two files read into one Buffer pool — routine in
    // Node), readFile(viewOfB) SILENTLY returned file A's dataset: same
    // element count, wrong data, no error. The contract — parsing a view
    // equals parsing view.buffer.slice(byteOffset, byteOffset+byteLength).
    it("parsing a pooled view equals parsing its exact slice", () => {
        const a = fileA();
        const b = fileB();
        expect(a.length).toBe(b.length); // same layout, Rows differs
        const pool = new ArrayBuffer(a.length + b.length);
        new Uint8Array(pool).set(a, 0);
        new Uint8Array(pool).set(b, a.length);
        const viewOfB = new Uint8Array(pool, a.length, b.length);

        const { dict } = DicomMessage.readFile(viewOfB);
        // Must be file B (Rows 16) — the old footgun returned file A
        // (Rows 32), silently.
        expect(dict[TagHex.Rows].Value).toEqual([FILE_B_ROWS]);

        // Full equivalence with the exact-slice parse:
        const sliceDict = DicomMessage.readFile(
            pool.slice(a.length, a.length + b.length)
        ).dict;
        expect(Object.keys(dict).sort()).toEqual(Object.keys(sliceDict).sort());
    });

    // Review finding 1: a Node Buffer, unlike a plain Uint8Array, has an
    // `offset` property equal to byteOffset. ReadBufferStream used to seed
    // its read offset from it, which only cancelled out while the whole
    // backing pool was adopted; once the constructor adopts exactly the
    // viewed bytes, any surviving `buffer.offset` seed would start the
    // parse byteOffset bytes into the data and throw "Invalid DICOM
    // file, expected header is missing". This pins the contract for the
    // shapes Node pools: fs.readFileSync below 4096 bytes,
    // Buffer.from(str, "base64") and every buf.subarray.
    it("a Node Buffer subarray at a nonzero byteOffset parses like the copy", () => {
        const raw = Buffer.from(fileA());
        const shifted = Buffer.concat([Buffer.alloc(97), raw]).subarray(97);
        // At least the 97 skipped bytes; more when Node pools the concat
        // result itself (allocation strategy varies by Node version).
        expect(shifted.byteOffset).toBeGreaterThanOrEqual(97);
        expect(shifted.equals(raw)).toBe(true);

        const { dict } = DicomMessage.readFile(shifted);
        expect(dict[TagHex.Rows].Value).toEqual([FILE_A_ROWS]);
        expect(dict[TagHex.PixelData].Value[0].byteLength).toBe(
            defaultImage.totalPixelBytes
        );
    });
});
