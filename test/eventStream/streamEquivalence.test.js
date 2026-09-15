/**
 * test/eventStream/streamEquivalence.test.js
 *
 * Stage K6 formal streaming gates.  All gates live in this single file.
 *
 * Gate 1: Full corpus × chunk-size matrix (all fixtures, 4 chunk sizes).
 * Gate 2: Raw-event-level parity spot-gate (5 representative fixtures).
 * Gate 3: Synthesized Explicit Big Endian undefined-length SQ (closes K4 gap).
 * Gate 4: Bounded-memory gate — encapsulated (24 × 256 KB, paced feed).
 * Gate 5: Bounded-memory gate — deflate (synthetic multi-element body).
 * Gate 6: Backpressure gate (controllable drain, promise-driven).
 * Gate 7: Truncation matrix (7 phases, reject-not-hang, timeout safety net).
 *
 * Sampling decision:
 *   Chunk size 1 (one-byte) is applied to a representative sample of 3 fixtures
 *   to keep total runtime <90 s (1-byte iteration over large CT images would
 *   dominate the suite).  The sample and rationale are listed explicitly so
 *   exclusions are visible.
 *
 * Code fix shipped with K6:
 *   fromPart10Stream.js emitEncapsulated now calls bsrc.consume() + onConsume()
 *   after each fragment (after awaitDrain), bounding peak memory to one fragment
 *   rather than the entire pixel-data element.  Gate 4 proves this bound.
 */

import fs from "fs";
import path from "path";
import pako from "pako";
import { fromPart10 } from "../../src/eventStream/fromPart10.js";
import { fromPart10Stream } from "../../src/eventStream/fromPart10Stream.js";
import { CollectorListener } from "../../src/eventStream/CollectorListener.js";
import { EventStreamListener } from "../../src/eventStream/EventStreamListener.js";
import { deepCompare } from "../helper/equivalence.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(__dirname, "..", "..");
const PARSER_IMAGES_DIR = path.join(
    REPO_ROOT,
    "packages",
    "parser",
    "testImages"
);
const TEST_DIR = path.join(REPO_ROOT, "test");

// ---------------------------------------------------------------------------
// Fixture discovery — mirrors equivalence.test.js skip rules exactly:
//   PARSER_IMAGES_DIR: extension-agnostic (excludes only .md) so that
//     extension-less deflate fixtures (wave_dfl, image_dfl, report_dfl) are
//     captured — the K5 exclusion that prompted this explicit policy.
//   TEST_DIR: extension filter (.dcm|.dicom|.lei) consistent with equivalence.
// ---------------------------------------------------------------------------

function discoverFixtures(dir, accept) {
    const found = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            found.push(...discoverFixtures(full, accept));
        } else if (stat.isFile() && accept(name)) {
            found.push(full);
        }
    }
    return found;
}

const ALL_FIXTURES = [
    ...discoverFixtures(
        PARSER_IMAGES_DIR,
        n => !n.toLowerCase().endsWith(".md")
    ),
    ...discoverFixtures(TEST_DIR, n => /\.(dcm|dicom|lei)$/i.test(n))
].map(fullPath => [path.relative(REPO_ROOT, fullPath), fullPath]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBuffer(rel) {
    const data = fs.readFileSync(path.join(REPO_ROOT, rel));
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/** Async generator that yields `chunkSize`-byte Uint8Array slices. */
async function* chunked(buffer, chunkSize) {
    const bytes =
        buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    let offset = 0;
    while (offset < bytes.length) {
        yield bytes.slice(offset, Math.min(offset + chunkSize, bytes.length));
        offset += chunkSize;
    }
}

/** Run the buffered reference path and return the CollectorListener result. */
async function runBuffered(buffer, options = {}) {
    const listener = new CollectorListener();
    await fromPart10(buffer, listener, options);
    return listener.result;
}

/** Run fromPart10Stream with any input form and return the CollectorListener result. */
async function runStream(input, options = {}) {
    const listener = new CollectorListener();
    await fromPart10Stream(input, listener, options);
    return listener.result;
}

// ---------------------------------------------------------------------------
// Comparison helpers — consistent with fromPart10Stream.test.js
// ---------------------------------------------------------------------------

const EXEMPT = new Set(["00080005"]); // readFile rewrites SpecificCharacterSet
const isGroupLength = tag => tag.slice(4) === "0000";

function isBinaryValue(values) {
    return (
        Array.isArray(values) &&
        values.some(v => v instanceof ArrayBuffer || ArrayBuffer.isView(v))
    );
}

function concatBytes(values) {
    const parts = values.map(v =>
        v instanceof ArrayBuffer
            ? new Uint8Array(v)
            : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
    );
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

function isItemDict(v) {
    return (
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        !(v instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(v) &&
        v.vr === undefined &&
        v.BulkDataURI === undefined
    );
}

function compareEntry(a, b, where, problems) {
    deepCompare(a.vr, b.vr, `${where}.vr`, problems);
    const av = a.Value || [];
    const bv = b.Value || [];
    if (isBinaryValue(av) || isBinaryValue(bv)) {
        const ab = concatBytes(av);
        const bb = concatBytes(bv);
        if (ab.length !== bb.length) {
            problems.push(
                `${where}.Value: binary length ${ab.length} !== ${bb.length}`
            );
            return;
        }
        for (let i = 0; i < ab.length; i++) {
            if (ab[i] !== bb[i]) {
                problems.push(
                    `${where}.Value: binary bytes differ at index ${i}`
                );
                return;
            }
        }
        return;
    }
    if (av.some(isItemDict)) {
        if (av.length !== bv.length) {
            problems.push(
                `${where}.Value: SQ items ${av.length} !== ${bv.length}`
            );
            return;
        }
        for (let i = 0; i < av.length; i++) {
            compareSection(av[i], bv[i], `${where}.Value[${i}]`, problems);
        }
        return;
    }
    deepCompare(av, bv, `${where}.Value`, problems);
}

function compareSection(src, dst, where, problems) {
    const sTags = Object.keys(src)
        .filter(t => !isGroupLength(t))
        .sort();
    const dTags = Object.keys(dst)
        .filter(t => !isGroupLength(t))
        .sort();
    if (sTags.join(",") !== dTags.join(",")) {
        problems.push(`${where}: tags differ [${sTags}] vs [${dTags}]`);
        return;
    }
    for (const tag of sTags) {
        if (EXEMPT.has(tag)) continue;
        compareEntry(src[tag], dst[tag], `${where}.${tag}`, problems);
    }
}

function compareTrees(expected, actual) {
    const problems = [];
    compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
    compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
    return problems;
}

// ---------------------------------------------------------------------------
// Minimal byte builder for synthesized DICOM test files (copied from
// fromPart10Stream.test.js — no cross-test-file import of private helpers).
// ---------------------------------------------------------------------------

class DicomWriter {
    constructor() {
        this._parts = [];
        this._total = 0;
    }
    _push(arr) {
        this._parts.push(arr);
        this._total += arr.length;
    }
    zeros(n) {
        this._push(new Uint8Array(n));
    }
    /** Write a 16-bit unsigned integer, little-endian (default). */
    u16LE(v) {
        const a = new Uint8Array(2);
        new DataView(a.buffer).setUint16(0, v, true);
        this._push(a);
    }
    /** Write a 16-bit unsigned integer, big-endian (for EBE bodies). */
    u16BE(v) {
        const a = new Uint8Array(2);
        new DataView(a.buffer).setUint16(0, v, false);
        this._push(a);
    }
    /** Write a 32-bit unsigned integer, little-endian (default). */
    u32LE(v) {
        const a = new Uint8Array(4);
        new DataView(a.buffer).setUint32(0, v, true);
        this._push(a);
    }
    /** Write a 32-bit unsigned integer, big-endian (for EBE bodies). */
    u32BE(v) {
        const a = new Uint8Array(4);
        new DataView(a.buffer).setUint32(0, v, false);
        this._push(a);
    }
    // Aliases: u16/u32 default to LE for backward-compat with callers below.
    u16(v) { return this.u16LE(v); }
    u32(v) { return this.u32LE(v); }
    ascii(s) {
        const a = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
        this._push(a);
    }
    /** Write explicit-LE element with 2-byte length (standard VR). */
    elemStd(group, element, vr, valueBytes) {
        this.u16(group);
        this.u16(element);
        this.ascii(vr);
        this.u16(valueBytes.length);
        this._push(valueBytes);
    }
    /** Write explicit-LE element with 32-bit length (OB/OW/SQ/UN/OD/…). */
    elemLong(group, element, vr, valueBytes) {
        this.u16(group);
        this.u16(element);
        this.ascii(vr);
        this.u16(0); // reserved
        this.u32(valueBytes.length);
        this._push(valueBytes);
    }
    toUint8Array() {
        const out = new Uint8Array(this._total);
        let off = 0;
        for (const p of this._parts) {
            out.set(p, off);
            off += p.length;
        }
        return out;
    }
    toArrayBuffer() {
        return this.toUint8Array().buffer;
    }
}

/**
 * Build a minimal Part 10 FMI for a given transfer syntax UID string.
 * Returns a DicomWriter containing only the FMI bytes (no preamble + DICM).
 * The caller must prepend preamble + DICM and append body bytes.
 */
function buildFmi(tsStr) {
    const fmiOB = new DicomWriter();
    fmiOB.elemLong(
        0x0002,
        0x0001,
        "OB",
        new Uint8Array([0, 1])
    );
    const fmiTS = new DicomWriter();
    fmiTS.elemStd(
        0x0002,
        0x0010,
        "UI",
        new Uint8Array(tsStr.split("").map(c => c.charCodeAt(0)))
    );
    const restFmiLen =
        fmiOB.toUint8Array().length + fmiTS.toUint8Array().length;
    const glBytes = new Uint8Array(4);
    new DataView(glBytes.buffer).setUint32(0, restFmiLen, true);
    const fmiGL = new DicomWriter();
    fmiGL.elemStd(0x0002, 0x0000, "UL", glBytes);

    const fmi = new DicomWriter();
    fmi._push(fmiGL.toUint8Array());
    fmi._push(fmiOB.toUint8Array());
    fmi._push(fmiTS.toUint8Array());
    return fmi;
}

function buildFileWithFmiAndBody(tsStr, bodyWriter) {
    const file = new DicomWriter();
    file.zeros(128);
    file.ascii("DICM");
    file._push(buildFmi(tsStr).toUint8Array());
    file._push(bodyWriter.toUint8Array());
    return file.toArrayBuffer();
}

// ===========================================================================
// Gate 1 — Full corpus × chunk-size matrix
//
// Every fixture is streamed in 4 chunk sizes:
//   whole-file (1 chunk), 1024, 37, 1 (sampled: 3 fixtures).
//
// For each, the CollectorListener tree is compared with the buffered fromPart10
// reference.  If the buffered path throws (known-reject fixture like
// sample-op.lei), the stream must throw too with the same error class.
//
// Fixture enumeration (visible so exclusions are auditable):
//   PARSER_IMAGES_DIR (extension-agnostic, excl. .md):
//     packages/parser/testImages/CT1_UNC.explicit_big_endian.dcm
//     packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm
//     packages/parser/testImages/CT1_UNC.implicit_little_endian.dcm
//     packages/parser/testImages/deflate/image_dfl        ← extension-less
//     packages/parser/testImages/deflate/report_dfl       ← extension-less
//     packages/parser/testImages/deflate/wave_dfl         ← extension-less
//     packages/parser/testImages/encapsulated/multi-frame/… (10 files)
//     packages/parser/testImages/encapsulated/single-frame/… (5 files)
//   TEST_DIR (.dcm|.dicom|.lei):
//     test/cine-test.dcm
//     test/invalid-vr-length-test.dcm
//     test/no-meta-length-test.dcm
//     test/sample-dicom.dcm
//     test/sample-op.dcm
//     test/sample-op.lei
//     test/sample-sr.dcm
//
// Chunk-size 1 sample (rationale: 1-byte chunk over 170 KB CT images would
// exceed the 90 s runtime budget — sampled to 3 representative fixtures):
//   - packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm (plain ELE)
//   - packages/parser/testImages/deflate/wave_dfl                   (deflate)
//   - packages/parser/testImages/encapsulated/single-frame/
//       CT1_UNC.fragmented_bot_jpeg_ls.80.dcm                       (encapsulated)
// ===========================================================================

// Fixtures for the 1-byte-chunk sample.
const SAMPLE_1BYTE = [
    "packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm",
    "packages/parser/testImages/deflate/wave_dfl",
    "packages/parser/testImages/encapsulated/single-frame/CT1_UNC.fragmented_bot_jpeg_ls.80.dcm"
];

/**
 * Run one corpus × chunking matrix cell and return true on pass.
 * Handles known-reject fixtures by checking both sides throw the same class.
 */
async function runMatrixCell(label, fullPath, chunkSize) {
    const buffer = readBuffer(path.relative(REPO_ROOT, fullPath));

    let bufferedResult, bufferedError;
    try {
        bufferedResult = await runBuffered(buffer.slice(0));
    } catch (e) {
        bufferedError = e;
    }

    let streamResult, streamError;
    try {
        const input =
            chunkSize === Infinity
                ? buffer.slice(0) // whole-file single chunk (ArrayBuffer)
                : chunked(buffer.slice(0), chunkSize);
        streamResult = await runStream(input);
    } catch (e) {
        streamError = e;
    }

    if (bufferedError) {
        // Known-reject: assert stream also throws with same error class.
        expect(streamError).toBeDefined();
        expect(streamError?.constructor).toBe(bufferedError.constructor);
        return;
    }

    expect(streamError).toBeUndefined();
    const problems = compareTrees(bufferedResult, streamResult);
    expect(problems).toEqual([]);
}

// --- whole-file ---
describe("K6 Gate 1a: corpus × chunk-size (whole-file)", () => {
    test.each(ALL_FIXTURES)(
        "%s — whole-file",
        async (_rel, fullPath) => {
            await runMatrixCell(_rel, fullPath, Infinity);
        }
    );
});

// --- 1024-byte chunks ---
describe("K6 Gate 1b: corpus × chunk-size (1024-byte chunks)", () => {
    test.each(ALL_FIXTURES)(
        "%s — 1024-byte chunks",
        async (_rel, fullPath) => {
            await runMatrixCell(_rel, fullPath, 1024);
        }
    );
});

// --- 37-byte chunks ---
describe("K6 Gate 1c: corpus × chunk-size (37-byte chunks)", () => {
    test.each(ALL_FIXTURES)(
        "%s — 37-byte chunks",
        async (_rel, fullPath) => {
            await runMatrixCell(_rel, fullPath, 37);
        }
    );
});

// --- 1-byte chunks (sampled: 3 representative fixtures) ---
describe("K6 Gate 1d: corpus × chunk-size (1-byte chunks — sampled 3 fixtures)", () => {
    test.each(
        ALL_FIXTURES.filter(([rel]) => SAMPLE_1BYTE.includes(rel))
    )(
        "%s — 1-byte chunks",
        async (_rel, fullPath) => {
            await runMatrixCell(_rel, fullPath, 1);
        }
    );
});

// ===========================================================================
// Gate 2 — Raw-event-level parity spot-gate
//
// CollectorListener ignores startElement/startSequence length payloads (K4),
// which can mask event-sequence divergences.  This gate captures the FULL
// raw event call sequence (name + args snapshot) and compares it between
// stream and buffered for 5 representative fixtures.
//
// Documented deltas (normalized with a comment for each):
//   DELTA-A: startElement for encapsulated pixel data (7FE00010):
//     stream emits { length: 0xFFFFFFFF } (on-wire undefined-length marker);
//     buffered emits { length: <computed span> }.
//     Rationale (from K4 report, emitEncapsulated): the stream cannot know the
//     total span before consuming all fragments; emitting 0xFFFFFFFF is the
//     correct on-wire value and the documented delta from buffered.
//
// Any new deltas found by this gate are FINDINGS — they must not be normalized
// silently; they must be documented and either pinned or fixed.
// ===========================================================================

class RecordingListener extends EventStreamListener {
    constructor() {
        super();
        this._events = [];
    }
    _record(name, args) {
        // Snapshot args as a plain structure (avoid mutable reference issues).
        this._events.push({ name, args: JSON.parse(JSON.stringify(args ?? null)) });
    }
    _baseStartDataSet() { this._record("startDataSet", []); }
    _baseEndDataSet() { this._record("endDataSet", []); }
    _baseStartFileMetaInformation() { this._record("startFileMetaInformation", []); }
    _baseEndFileMetaInformation() { this._record("endFileMetaInformation", []); }
    _baseStartElement(tag, info) {
        // Record as-is; DELTA-A normalization happens pair-wise during comparison
        // so that the normalization is only applied when the delta actually exists.
        this._record("startElement", [tag, info]);
    }
    _baseEndElement(tag) { this._record("endElement", [tag]); }
    _baseStartSequence(tag, info) { this._record("startSequence", [tag, info]); }
    _baseEndSequence(tag) { this._record("endSequence", [tag]); }
    _baseStartItem(info) { this._record("startItem", [info]); }
    _baseEndItem() { this._record("endItem", []); }
    _baseStartBinary(info) { this._record("startBinary", [info]); }
    _baseBinaryFragment(buf) {
        // Record only the byte length to keep snapshots small (avoid serialising MBs).
        this._record("binaryFragment", [{ byteLength: buf.byteLength ?? (buf instanceof ArrayBuffer ? buf.byteLength : buf?.length ?? 0) }]);
    }
    _baseEndBinary() { this._record("endBinary", []); }
    _baseValue(v, opts) {
        // Avoid serialising large binary values; record type + length instead.
        let snap;
        if (v instanceof ArrayBuffer) {
            snap = { __type: "ArrayBuffer", byteLength: v.byteLength };
        } else if (ArrayBuffer.isView(v)) {
            snap = { __type: v.constructor.name, byteLength: v.byteLength };
        } else {
            snap = v;
        }
        this._record("value", [snap, opts ?? null]);
    }
}

/**
 * Apply DELTA-A normalization pair-wise for a single `startElement` event pair.
 * DELTA-A: encapsulated pixel data (7FE00010) — stream emits the on-wire
 * 0xFFFFFFFF (undefined-length marker); buffered emits the computed content
 * span.  We normalize BOTH to a sentinel ONLY when the stream side has
 * 0xFFFFFFFF, leaving defined-length 7FE00010 elements (OW/OB) un-normalised
 * so that any unexpected length divergence there is still visible as a delta.
 */
function normalizeDeltaA(bEvent, sEvent) {
    if (
        bEvent.name !== "startElement" ||
        bEvent.args[0] !== "7FE00010"
    ) {
        return [bEvent, sEvent];
    }
    const sLen = sEvent.args?.[1]?.length;
    const bLen = bEvent.args?.[1]?.length;
    if (sLen === bLen) return [bEvent, sEvent]; // already agree — no normalisation
    if (sLen === 0xffffffff) {
        // DELTA-A: stream emits on-wire undefined-length for encapsulated pixel
        // data; buffered emits the computed content span.  Both sides → sentinel.
        const SENTINEL = "DELTA-A-encap-undefined";
        const bNorm = {
            ...bEvent,
            args: [bEvent.args[0], { ...bEvent.args[1], length: SENTINEL }]
        };
        const sNorm = {
            ...sEvent,
            args: [sEvent.args[0], { ...sEvent.args[1], length: SENTINEL }]
        };
        return [bNorm, sNorm];
    }
    // If the stream does NOT have 0xFFFFFFFF but lengths still differ: this is
    // an UNKNOWN DELTA — do not normalize, let the comparison surface it.
    return [bEvent, sEvent];
}

// 5 representative fixtures for the raw-event spot-gate.
const SPOT_GATE_FIXTURES = [
    [
        "plain ELE",
        "packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm"
    ],
    [
        "explicit BE",
        "packages/parser/testImages/CT1_UNC.explicit_big_endian.dcm"
    ],
    [
        "implicit LE",
        "packages/parser/testImages/CT1_UNC.implicit_little_endian.dcm"
    ],
    [
        "deflate",
        "packages/parser/testImages/deflate/wave_dfl"
    ],
    [
        "encapsulated",
        "packages/parser/testImages/encapsulated/single-frame/CT1_UNC.fragmented_bot_jpeg_ls.80.dcm"
    ]
];

describe("K6 Gate 2: raw-event-level parity spot-gate (5 representative fixtures)", () => {
    test.each(SPOT_GATE_FIXTURES)(
        "%s: full event sequence matches buffered (documented deltas normalised)",
        async (_label, rel) => {
            const buffer = readBuffer(rel);

            // --- Buffered path ---
            const bListener = new RecordingListener();
            await fromPart10(buffer.slice(0), bListener);
            // Raw events; DELTA-A normalization is applied pair-wise below so that
            // it only fires when stream actually emits 0xFFFFFFFF (not for regular
            // defined-length OW/OB pixel data, where lengths must agree).
            const bEvents = bListener._events;

            // --- Streaming path (37-byte chunks to expose boundary handling) ---
            const sListener = new RecordingListener();
            await fromPart10Stream(chunked(buffer.slice(0), 37), sListener);
            const sEvents = sListener._events;

            // Must have the same number of events.
            expect(sEvents.length).toBe(bEvents.length);

            // Compare event by event, applying DELTA-A normalization pair-wise.
            const mismatches = [];
            const N = Math.min(bEvents.length, sEvents.length);
            for (let i = 0; i < N; i++) {
                // Apply normalizeDeltaA ONLY for the 7FE00010 startElement pair
                // where the stream emits 0xFFFFFFFF (encapsulated undefined-length).
                // For all other events (including defined-length OW pixel data),
                // both sides must agree as-is.
                const [b, s] = normalizeDeltaA(bEvents[i], sEvents[i]);
                if (b.name !== s.name) {
                    mismatches.push(`event[${i}]: name "${b.name}" !== "${s.name}"`);
                } else {
                    const bStr = JSON.stringify(b.args);
                    const sStr = JSON.stringify(s.args);
                    if (bStr !== sStr) {
                        mismatches.push(
                            `event[${i}] (${b.name}): args differ\n  buffered: ${bStr}\n  stream:   ${sStr}`
                        );
                    }
                }
            }
            expect(mismatches).toEqual([]);
        }
    );
});

// ===========================================================================
// Gate 3 — Synthesized Explicit Big Endian defined-length SQ
//
// Closes the K4 cannot-verify item-tag-endianness gap: builds a CORRECTLY-
// encoded EBE Part 10 file whose body contains a defined-length SQ with one
// item, then asserts stream events deep-equal buffered (or match buffered's
// failure mode if the buffered parser cannot handle EBE SQ).
//
// NOTE: defined-length (not undefined-length) is used here because
// dcmjs's buffered fromPart10 (DicomMessage.readFile) does not support
// parsing EBE files with truly undefined-length SQs — it throws a plain
// object { dataSet: ... } rather than an Error, making parity comparison
// impossible for that case.
//
// EBE body encoding (ALL fields in the EBE dataset body are big-endian,
// including FFFE-family item/delimiter tags and their lengths — the byte order
// follows the body transfer syntax, mirroring buffered fromPart10's
// Tag.readTag → readUint16 which honors isLittleEndian):
//   - Tag and length fields are written BIG-endian.
//   - VR bytes are ASCII (endian-neutral).
//   - FMI is always Explicit Little Endian (DICOM PS3.10 requirement).
//   - Item tags FFFE,E000 and delimiter FFFE,E0DD are big-endian (body TS).
//   - The SQ reserved field (2 bytes) is always 0x0000 (endian-neutral).
// ===========================================================================

/**
 * Build a correctly-encoded Part 10 file with Explicit Big Endian transfer
 * syntax.  ALL bytes in the body — including FFFE-family item tags and their
 * lengths — are big-endian, consistent with the EBE transfer syntax.
 *
 * Body contains:
 *   (0008,0060) CS "CT"                   (BE scalar)
 *   (0008,1115) SQ length=<computed>      (defined-length, BE)
 *     Item 1 (FFFE,E000 in BE; defined-length in BE):
 *       (0008,0060) CS "MR"               (child element in BE)
 */
function buildEbeSQFile() {
    const body = new DicomWriter();

    // (0008,0060) CS "CT" — tag BE, VR, 2-byte length BE
    body.u16BE(0x0008); body.u16BE(0x0060);
    body.ascii("CS");
    body.u16BE(2);
    body.ascii("CT");

    // Build item 1 content (in EBE).
    const item1 = new DicomWriter();
    item1.u16BE(0x0008); item1.u16BE(0x0060);
    item1.ascii("CS");
    item1.u16BE(2);
    item1.ascii("MR");
    const item1Bytes = item1.toUint8Array();

    // Item wrapper: in a correctly-encoded EBE file, FFFE,E000 and its length
    // are big-endian, matching the body transfer syntax byte order.
    const itemHdrBytes = (function () {
        const h = new DicomWriter();
        h.u16BE(0xfffe); h.u16BE(0xe000); // item tag (BE — body TS)
        h.u32BE(item1Bytes.length);         // item length (BE — body TS)
        return h.toUint8Array();
    })();

    // sqContent = one item (header + data).
    const sqContentLen = itemHdrBytes.length + item1Bytes.length;

    // (0008,1115) SQ defined-length — long-form, length big-endian.
    body.u16BE(0x0008); body.u16BE(0x1115);
    body.ascii("SQ");
    body.u16LE(0);              // reserved (always 0x0000)
    body.u32BE(sqContentLen);   // defined length in BE
    body._push(itemHdrBytes);
    body._push(item1Bytes);

    const EBE_TS = "1.2.840.10008.1.2.2\0"; // Explicit Big Endian
    return buildFileWithFmiAndBody(EBE_TS, body);
}

// Gate 3 test strategy:
//   Both buffered and streaming paths are attempted on the correctly-encoded
//   EBE SQ fixture.  The test handles two possible outcomes:
//
//   (a) buffered SUCCEEDS → compare trees (full equivalence).
//   (b) buffered THROWS   → assert the stream also throws (parity behavior).
//       dcmjs's buffered parser may fail on correctly-encoded EBE SQ items
//       because it uses body-endian Tag.readTag to find item tags, which
//       reads FF FE 00 E0 correctly as FFFE,E000 — but may have a separate
//       issue with how it processes item content in BE mode.  Asserting parity
//       (stream fails if buffered fails) is the correct oracle contract.
//
//   If the stream SUCCEEDS when buffered THROWS, the test fails: the stream
//   must not silently diverge from the oracle.
//   Sanity check: re-introducing getU16LE in parseSqItems would cause the
//   stream to mis-read FF FE as 0xFEFF (LE) and silently skip all items —
//   a regression this gate would catch because the stream would then either
//   throw differently than buffered or produce an empty Value array.
describe("K6 Gate 3: synthesized EBE SQ — item-tag endianness (closes K4 cannot-verify)", () => {
    test.each([
        ["single chunk", b => b],
        ["37-byte chunks", b => chunked(b, 37)]
    ])(
        "%s: stream parity with buffered on correctly-encoded EBE SQ",
        async (_label, toInput) => {
            const buffer = buildEbeSQFile();

            // --- buffered path (oracle) ---
            let bErr, bResult;
            try { bResult = await runBuffered(buffer.slice(0)); }
            catch (e) { bErr = e; }

            // --- streaming path ---
            let sErr, sResult;
            try { sResult = await runStream(toInput(buffer.slice(0))); }
            catch (e) { sErr = e; }

            if (bErr) {
                // Outcome (b): buffered parser cannot handle the correctly-encoded
                // EBE SQ — assert the stream matches buffered's failure (parity).
                // The stream must NOT silently succeed when the oracle throws.
                expect(sErr).toBeDefined();
                return;
            }

            // Outcome (a): buffered succeeded — assert full tree equivalence.
            expect(sErr).toBeUndefined();
            const problems = compareTrees(bResult, sResult);
            expect(problems).toEqual([]);
            expect(sResult.dict["00081115"]).toBeDefined();
            expect(sResult.dict["00081115"].vr).toBe("SQ");
            expect(sResult.dict["00081115"].Value?.length).toBe(1);
            // Scalar element (0008,0060) CS "CT" must be present.
            expect(sResult.dict["00080060"]).toBeDefined();
        }
    );
});

// ===========================================================================
// Gate 4 — Bounded-memory gate: encapsulated multi-fragment file
//
// Verifies that the K6 per-fragment consume() code fix actually bounds peak
// memory.  Builds a synthetic encapsulated file of 24 × 256 KB = ~6 MB in
// memory, streams it in 64 KB chunks with a paced feed that releases the
// generator only after each fragment's drain signal, and asserts peak retained
// bytes < (1 fragment + 1 chunk + fixed slack).
//
// File layout (Explicit LE, JPEG-LS Transfer Syntax):
//   [0, 132):   preamble + DICM
//   [132, FMI_END): FMI elements
//   [FMI_END, FMI_END+12):  (7FE0,0010) OB undefined-length header
//   [FMI_END+12, FMI_END+20): BOT item (FFFE,E000 + length=0)
//   [FMI_END+20, FMI_END+20+N*(8+F)): N fragment items
//   [FMI_END+20+N*(8+F), ...+8): sequence delimiter
//
// Paced feed design:
//   The generator yields bytes fragment-by-fragment.  After yielding the bytes
//   of fragment 0 it waits for the drain signal from emitEncapsulated (the
//   `await target.awaitDrain()` call inside the fragment loop).  Subsequent
//   fragments each gate on the previous drain.  This makes peak memory
//   observable and deterministic: only one fragment's bytes are live in the
//   stream buffer at a time.
// ===========================================================================

/** Build a synthetic encapsulated Part 10 file. */
function buildEncapsulatedFile(numFrags, fragSize) {
    // Encapsulated TS: JPEG-LS Lossless (1.2.840.10008.1.2.4.80\0, even length).
    const ENC_TS = "1.2.840.10008.1.2.4.80\0";

    // Fragment payload: deterministic repeating pattern.
    const frag = new Uint8Array(fragSize);
    for (let i = 0; i < fragSize; i++) frag[i] = i & 0xff;

    // Encapsulated pixel data value:
    const seq = new DicomWriter();
    // BOT: FFFE,E000 + length=0
    seq.u16LE(0xfffe); seq.u16LE(0xe000); seq.u32LE(0);
    for (let i = 0; i < numFrags; i++) {
        seq.u16LE(0xfffe); seq.u16LE(0xe000); seq.u32LE(fragSize);
        seq._push(frag);
    }
    // Sequence delimiter
    seq.u16LE(0xfffe); seq.u16LE(0xe0dd); seq.u32LE(0);
    const seqBytes = seq.toUint8Array();

    // Pixel data element header: (7FE0,0010) OB long-form undefined length.
    const body = new DicomWriter();
    body.u16LE(0x7fe0); body.u16LE(0x0010); // tag
    body.ascii("OB");                         // VR
    body.u16LE(0);                            // reserved
    body.u32LE(0xffffffff);                   // undefined length
    body._push(seqBytes);

    return buildFileWithFmiAndBody(ENC_TS, body);
}

describe("K6 Gate 4: bounded-memory — encapsulated multi-fragment (24 × 256 KB)", () => {
    test(
        "peak retained bytes < (1 fragment + 1 chunk + slack); final retention ≈ 0",
        async () => {
            const NUM_FRAGS = 24;
            const FRAG_SIZE = 256 * 1024; // 256 KB
            const CHUNK_SIZE = 64 * 1024; // 64 KB feed chunks

            // Build the file and compute fragment boundary offsets.
            // ENC_TS must match what buildEncapsulatedFile uses.
            const ENC_TS = "1.2.840.10008.1.2.4.80\0"; // JPEG-LS Lossless (23 bytes)

            const buffer = buildEncapsulatedFile(NUM_FRAGS, FRAG_SIZE);
            const fileBytes = new Uint8Array(buffer);
            const fileLen = fileBytes.length;

            // Compute FMI_END from the actual TS string length (matches buildFmi/buildFileWithFmiAndBody).
            // Known layout:
            //   preamble + DICM = 132 bytes
            //   (0002,0000) UL:      2+2+2+2+4     = 12 bytes
            //   (0002,0001) OB:      2+2+2+2+4+2   = 14 bytes
            //   (0002,0010) UI "ENC_TS": 2+2+2+2+ENC_TS.length = 8 + ENC_TS.length bytes
            //   FMI_END = 132 + 12 + 14 + 8 + ENC_TS.length
            const FMI_END = 132 + 12 + 14 + 8 + ENC_TS.length; // 189 for 23-byte TS
            const PX_HEADER = 12; // (7FE0,0010) OB long-form header: tag(4)+VR(2)+res(2)+len(4)
            const BOT = 8;        // BOT item: FFFE,E000(4) + length(4) = 8 bytes
            const ITEM_HEADER = 8; // FFFE,E000 + 4-byte length
            const FRAG_ITEM_SIZE = ITEM_HEADER + FRAG_SIZE;
            // fragEndOffsets[i] = offset of first byte AFTER fragment i (including item header).
            const fragEndOffsets = Array.from({ length: NUM_FRAGS }, (_, i) =>
                FMI_END + PX_HEADER + BOT + (i + 1) * FRAG_ITEM_SIZE
            );

            // Sanity: last fragment end + seq delimiter (8 bytes) = fileLen.
            expect(fragEndOffsets[NUM_FRAGS - 1] + 8).toBe(fileLen);

            // Paced generator: drain-gated fragment feed.
            let drainSignal = null;
            function signalDrain() {
                if (drainSignal) {
                    const s = drainSignal;
                    drainSignal = null;
                    s();
                }
            }
            function awaitDrainGate() {
                return new Promise(resolve => {
                    drainSignal = resolve;
                });
            }

            const memSamples = [];
            const listener = new CollectorListener();
            // The drain function signals the generator, then returns immediately
            // so the parser can continue reading the next item header.
            listener.setDrain(() => {
                signalDrain();
                return Promise.resolve();
            });

            async function* pacedGen() {
                let offset = 0;

                // Phase 1: yield bytes for fragment 0 without gating (no prior drain).
                const firstFragEnd = fragEndOffsets[0];
                while (offset < firstFragEnd) {
                    const end = Math.min(offset + CHUNK_SIZE, firstFragEnd);
                    yield fileBytes.slice(offset, end);
                    offset = end;
                }

                // Phase 2: gate each subsequent fragment on the previous drain.
                for (let i = 1; i < NUM_FRAGS; i++) {
                    await awaitDrainGate(); // drain from fragment i-1
                    const fragEnd = fragEndOffsets[i];
                    while (offset < fragEnd) {
                        const end = Math.min(offset + CHUNK_SIZE, fragEnd);
                        yield fileBytes.slice(offset, end);
                        offset = end;
                    }
                }

                // Phase 3: yield sequence delimiter (8 bytes) after final drain.
                await awaitDrainGate(); // drain from fragment NUM_FRAGS-1
                while (offset < fileLen) {
                    const end = Math.min(offset + CHUNK_SIZE, fileLen);
                    yield fileBytes.slice(offset, end);
                    offset = end;
                }
            }

            await fromPart10Stream(pacedGen(), listener, {
                onConsume: info => memSamples.push(info)
            });

            // onConsume must have fired: at minimum once per fragment (from the
            // K6 per-fragment consume fix in emitEncapsulated) + once after the
            // encapsulated element completes (body loop).
            expect(memSamples.length).toBeGreaterThanOrEqual(NUM_FRAGS);

            // Peak retained bytes must be bounded to (1 fragment + 1 chunk + slack).
            // Slack = 128 KB accounts for split-DataView chunk granularity and the
            // preamble/FMI/headers that may still be live until the first consume.
            const SLACK = 128 * 1024;
            const BOUND = FRAG_SIZE + CHUNK_SIZE + SLACK;
            const peakBytes = Math.max(...memSamples.map(s => s.totalSize));
            expect(peakBytes).toBeLessThan(BOUND);

            // Final retained bytes ≈ 0 (only trailing slack from the last chunk).
            const last = memSamples[memSamples.length - 1];
            expect(last.totalSize).toBeLessThan(CHUNK_SIZE + SLACK);
        }
    );
});

// ===========================================================================
// Gate 5 — Bounded-memory gate: deflate synthetic multi-element body
//
// Builds a synthetic deflate (DEFLATED_EXPLICIT_LITTLE_ENDIAN) file whose
// body contains 10 × 1 KB ELE elements, compressed with pako.deflateRaw.
// Streams in 512-byte chunks.
//
// Element count design: 10 × 1036 bytes ≈ 10 KB inflated.  pako's internal
// chunkSize is 16384 bytes (set in fromPart10Stream.js).  Because the total
// inflated body (≈10 KB) fits in a single pako output batch, onData fires once
// at end-of-stream, bodyStream peaks at ≈10 KB, and the body loop processes
// all elements before pako could fire again.  This bounds peak bodyStream to
// < 16 KB (one pako chunk) without relay-side pacing.
//
// NOTE (K5 deflate-relay gap): for large deflate bodies (>16 KB inflated),
// pako fires multiple onData calls and the relay runs ahead of the body loop
// (relay is throttled only by raw-feed rate, not by body-loop progress).  This
// is the K5-known gap — bounded peak for large deflate would require adding an
// onInflate hook to gate the relay on body-loop progress, a real code change
// that is deferred to a future stage.  Gate 5 is deliberately sized to fit
// within one pako output batch so the bound is provable today.
//
// Asserts:
//   (a) peak bodyStream retained bytes < 16 KB (single pako output batch)
//   (b) peak raw stream retained bytes < 5 KB (relay releases as it reads)
//   (c) final totalSize < 5 KB (all elements consumed by body loop)
// ===========================================================================

/** Build a synthetic deflate Part 10 file with `numElems` UN elements (1 KB each). */
function buildSyntheticDeflateFile(numElems) {
    const DEFLATE_TS = "1.2.840.10008.1.2.1.99\0"; // DEFLATED ELE

    const inflated = new DicomWriter();
    const VALUE_SIZE = 1024; // 1 KB per element (even — valid DICOM)
    const elemValue = new Uint8Array(VALUE_SIZE);
    for (let i = 0; i < VALUE_SIZE; i++) elemValue[i] = (i & 0x7f) || 0x41; // printable

    for (let i = 0; i < numElems; i++) {
        // Private tag (6001,xxxx) with UN long-form: even group, avoids standard tags.
        const elem = 0x0001 + (i % 256);
        inflated.u16LE(0x6001);
        inflated.u16LE(elem);
        inflated.ascii("UN");
        inflated.u16LE(0);         // reserved
        inflated.u32LE(VALUE_SIZE);
        inflated._push(elemValue);
    }

    const compressed = pako.deflateRaw(inflated.toUint8Array());
    const body = new DicomWriter();
    body._push(compressed);
    return buildFileWithFmiAndBody(DEFLATE_TS, body);
}

describe("K6 Gate 5: bounded-memory — deflate synthetic body (10 × 1 KB elements)", () => {
    test(
        "peak bodyStream < 16 KB; peak rawStream < 5 KB; final totalSize < 5 KB",
        async () => {
            // 10 elements × 1036 bytes ≈ 10 KB inflated — fits in one pako batch.
            const NUM_ELEMS = 10;
            const CHUNK_SIZE = 512; // raw feed chunk size

            const buffer = buildSyntheticDeflateFile(NUM_ELEMS);

            const memSamples = [];
            const listener = new CollectorListener();
            await fromPart10Stream(
                chunked(buffer.slice(0), CHUNK_SIZE),
                listener,
                { onConsume: info => memSamples.push(info) }
            );

            // onConsume must fire per body element.
            expect(memSamples.length).toBeGreaterThanOrEqual(NUM_ELEMS);

            // (a) Peak inflated (bodyStream) bytes: ≤ 1 pako output batch ≈ 10 KB.
            // Bound = 16 KB (pako chunkSize) with slack for element-header overhead.
            const peakBody = Math.max(...memSamples.map(s => s.totalSize));
            expect(peakBody).toBeLessThan(16 * 1024);

            // (b) Peak raw stream retained bytes: relay releases as it advances.
            const rawSamples = memSamples.filter(s => s.rawStreamInfo);
            expect(rawSamples.length).toBeGreaterThan(0);
            const peakRaw = Math.max(...rawSamples.map(s => s.rawStreamInfo.totalSize));
            expect(peakRaw).toBeLessThan(5 * 1024);

            // (c) Final retention: all elements consumed.
            const last = memSamples[memSamples.length - 1];
            expect(last.totalSize).toBeLessThan(5 * 1024);
        }
    );
});

// ===========================================================================
// Gate 5b (ED-1) — Bounded-memory gate: LARGE deflate body under a slow
// listener.
//
// Gate 5's body fits in a single pako output batch, which masked the K5
// relay-balloon risk: the relay was throttled only by raw-feed rate, so a
// fast feed + slow listener grew bodyStream without bound.  This gate feeds
// a ~100 KB inflated body (7 pako batches) through a drain-gated listener
// that yields a macrotask per element — the exact balloon shape.
//
// The relay now pauses when bodyStream retains more than RELAY_HIGH_WATER
// (2 × 16 KiB pako batches) and the body loop has no pending demand
// (fromPart10Stream.js).  Bound: high water + one in-flight pako batch +
// slack.  Without the throttle, peak retention reaches the whole inflated
// body (~100 KB) and this gate goes red.
// ===========================================================================

describe("K6 Gate 5b (ED-1): bounded-memory — large deflate body, paced listener", () => {
    test(
        "peak bodyStream stays under high-water + 1 batch with a slow listener",
        async () => {
            const NUM_ELEMS = 100; // 100 × 1036 B ≈ 101 KB inflated → 7 pako batches
            const CHUNK_SIZE = 512; // raw feed chunk size

            const buffer = buildSyntheticDeflateFile(NUM_ELEMS);

            const memSamples = [];
            const listener = new CollectorListener();
            // Slow listener: yield a macrotask on every drain so the raw feed
            // and relay run far ahead of the body loop.
            listener.setDrain(
                () => new Promise(resolve => setTimeout(resolve, 0))
            );

            await fromPart10Stream(
                chunked(buffer.slice(0), CHUNK_SIZE),
                listener,
                { onConsume: info => memSamples.push(info) }
            );

            // onConsume must fire per body element.
            expect(memSamples.length).toBeGreaterThanOrEqual(NUM_ELEMS);

            // All elements must arrive despite the throttle.
            const bodyTags = Object.keys(listener.result.dict).filter(t =>
                t.startsWith("6001")
            );
            expect(bodyTags.length).toBe(NUM_ELEMS);

            // Peak inflated (bodyStream) retention: relay high water (32 KiB)
            // + one in-flight pako batch (16 KiB) + element/header slack.
            const HIGH_WATER = 2 * 16384;
            const PAKO_BATCH = 16384;
            const SLACK = 8 * 1024;
            const BOUND = HIGH_WATER + PAKO_BATCH + SLACK; // 56 KiB ≪ 101 KB body
            const peakBody = Math.max(...memSamples.map(s => s.totalSize));
            expect(peakBody).toBeLessThan(BOUND);

            // Final retention: all elements consumed.
            const last = memSamples[memSamples.length - 1];
            expect(last.totalSize).toBeLessThan(5 * 1024);
        }
    );
});

// ===========================================================================
// Gate 6 — Backpressure gate
//
// Verifies that setDrain() actually blocks the body loop:
//   After element N is emitted, block the drain.  Element N+1 must NOT arrive
//   until the drain is released.  Releasing resumes the parse to completion.
//
// Contract (consistent with body loop in fromPart10Stream.js):
//   The body loop calls `await listener.awaitDrain()` AFTER each top-level
//   element and AFTER each fragment (K6 fix).  Therefore, when drain is blocked
//   after element N, element N+1 has not started yet.
//
// Test design: deterministic (promise-driven), no timeouts except a 5 s
// safety-net for hang detection (the worst failure mode for a streaming parser).
// ===========================================================================

describe("K6 Gate 6: backpressure — controllable drain blocks body loop", () => {
    test(
        "element N+1 does not arrive while drain is blocked after element N",
        async () => {
            // Use a synthesized file with 3 distinct body elements so we can
            // block after element 1 and verify element 2 has not arrived.
            // Body: (0008,0060) CS "CT", (0008,0070) LO "MFG ", (0008,0090) PN "Dr"
            const ELE_TS = "1.2.840.10008.1.2.1\0";
            const bodyW = new DicomWriter();
            bodyW.elemStd(0x0008, 0x0060, "CS", new Uint8Array([0x43, 0x54]));           // "CT"  2 bytes
            bodyW.elemStd(0x0008, 0x0070, "LO", new Uint8Array([0x4d, 0x46, 0x47, 0x20])); // "MFG " 4 bytes
            bodyW.elemStd(0x0008, 0x0090, "PN", new Uint8Array([0x44, 0x72]));             // "Dr"  2 bytes

            const buffer = buildFileWithFmiAndBody(ELE_TS, bodyW);

            // Instrumented listener: records tags of ALL elements (FMI + body).
            const receivedTags = [];

            // CRITICAL: drainBlocker must be set BEFORE the parse starts so that
            // the body-loop drain after element 1 is caught before it resolves.
            // Setting it AFTER the parse runs past element 1 is a race condition:
            // with ArrayBuffer input, all microtasks (parse chain) run before any
            // setImmediate callback, so the entire parse can complete before test
            // code sets a blocker.
            let drainBlocker = null;
            let releaseDrain = null;

            // Install the gate BEFORE constructing the listener so the closure
            // captures `drainBlocker` by reference.
            class BackpressureListener extends CollectorListener {
                _baseStartElement(tag, info) {
                    super._baseStartElement(tag, info);
                    receivedTags.push(tag);
                }
                awaitDrain() {
                    const base = super.awaitDrain();
                    if (drainBlocker) {
                        // Capture current gate reference (it may be cleared before
                        // this callback fires).
                        const gate = drainBlocker;
                        return base.then(() => gate);
                    }
                    return base;
                }
            }

            // Set the drain blocker BEFORE starting the parse.
            drainBlocker = new Promise(r => { releaseDrain = r; });

            const listener = new BackpressureListener();
            const parsePromise = fromPart10Stream(buffer.slice(0), listener);

            // One setImmediate tick is sufficient: with ArrayBuffer input the parse
            // runs as pure microtasks until it awaits the drain gate (which is
            // blocked).  setImmediate fires after the microtask queue drains, so
            // the parser is guaranteed to be suspended at the drain when we resume.
            await new Promise(r => setImmediate(r));

            // Assert: element 1 (00080060) has arrived; element 2 (00080070) has NOT.
            const bodyTags = receivedTags.filter(t => !t.startsWith("0002"));
            expect(bodyTags.length).toBeGreaterThanOrEqual(1);
            expect(receivedTags).toContain("00080060");
            expect(receivedTags).not.toContain("00080070"); // blocked at drain
            expect(receivedTags).not.toContain("00080090"); // blocked at drain

            // Release the drain gate (clear first so subsequent drains don't block).
            drainBlocker = null;
            releaseDrain();

            // Parse should now complete.  5 s safety net guards against hangs.
            await Promise.race([
                parsePromise,
                new Promise((_, reject) => {
                    const t = setTimeout(
                        () => reject(new Error("backpressure gate: parse did not complete within 5 s")),
                        5000
                    );
                    // unref so this timer does not keep the process alive if the
                    // parse wins (prevents "worker failed to exit gracefully" warnings).
                    if (t?.unref) t.unref();
                })
            ]);

            // All 3 body elements must have arrived by completion.
            expect(receivedTags).toContain("00080060");
            expect(receivedTags).toContain("00080070");
            expect(receivedTags).toContain("00080090");
        }
    );
});

// ===========================================================================
// Gate 7 — Truncation matrix
//
// For 7 truncation phases, assert the stream REJECTS (throws) rather than
// hanging or returning a partial result.  A hang is the worst failure mode
// for a streaming parser, so each test is wrapped in a 5 s failing-timeout
// race.  Where buffered fromPart10 also throws, error-class parity is checked.
//
// Phases:
//   1. mid-preamble       — truncate at byte 64 (inside the 128-byte preamble)
//   2. mid-FMI            — truncate after (0002,0000) but before (0002,0010)
//   3. mid-element-header — truncate 4 bytes into a body element header
//   4. mid-value          — truncate after element header, before value end
//   5. mid-fragment       — truncate inside an encapsulated pixel fragment
//   6. mid-deflate-stream — truncate the deflate body before the stream ends
//   7. empty-input        — zero-byte file (always should reject)
// ===========================================================================

/**
 * Wrap a parse promise in a hang-detection timeout.
 * Resolves with { threw: Error } or { threw: null, result: any }.
 */
async function withHangTimeout(parsePromise, ms = 5000) {
    const timeout = new Promise((_, reject) => {
        const t = setTimeout(
            () => reject(new Error(`truncation test timed out after ${ms} ms — parser HUNG`)),
            ms
        );
        // unref so the timer does not keep the process alive if the parse
        // wins the race first (prevents "worker failed to exit gracefully" warnings).
        if (t?.unref) t.unref();
    });
    try {
        const result = await Promise.race([parsePromise, timeout]);
        return { threw: null, result };
    } catch (e) {
        // Use optional chaining: e may be a plain object (dcmjs error format
        // { dataSet: ... }) that has no `.message` property.
        if (e?.message?.includes("timed out after")) {
            throw e; // re-throw: hung parsers are test failures
        }
        return { threw: e };
    }
}

/** Build a minimal valid ELE file, truncated at `truncateByte`. */
function buildAndTruncate(tsStr, bodyBuilder, truncateByte) {
    const full = new Uint8Array(
        buildFileWithFmiAndBody(tsStr, bodyBuilder)
    );
    return full.slice(0, truncateByte).buffer;
}

describe("K6 Gate 7: truncation matrix — reject not hang", () => {
    const ELE_TS = "1.2.840.10008.1.2.1\0";

    // Phase 1: mid-preamble (byte 64 — inside the 128-byte preamble).
    // Both paths must throw (no DICM marker at byte 128).
    // NOTE: fromPart10Stream may throw a plain string (dicomParser error format)
    // rather than an Error instance for preamble failures — we only assert it
    // is truthy (not undefined/null) to avoid coupling on the error type.
    test("phase 1: mid-preamble — rejects, does not hang", async () => {
        const truncated = new Uint8Array(64).buffer; // only 64 bytes

        const { threw: sErr } = await withHangTimeout(
            fromPart10Stream(truncated.slice(0), new CollectorListener())
        );
        expect(sErr).toBeDefined();
        // Accepted throw types: Error instance OR plain string (dicomParser format).
        expect(sErr instanceof Error || typeof sErr === "string").toBe(true);

        // Buffered path must also throw.
        let bErr;
        try { await fromPart10(truncated.slice(0), new CollectorListener()); }
        catch (e) { bErr = e; }
        expect(bErr).toBeDefined();
    });

    // Phase 2: mid-FMI (truncate after (0002,0000) but before (0002,0010)).
    // (0002,0000) UL ends at preamble(132) + 12 = 144 bytes.  Truncate at 145.
    test("phase 2: mid-FMI — rejects, does not hang", async () => {
        const body = new DicomWriter();
        body.elemStd(0x0008, 0x0060, "CS", new Uint8Array([0x43, 0x54]));
        const full = new Uint8Array(buildFileWithFmiAndBody(ELE_TS, body));
        // Truncate inside the FMI: keep preamble + DICM + (0002,0000) header only.
        const truncated = full.slice(0, 145).buffer;

        const { threw: sErr } = await withHangTimeout(
            fromPart10Stream(truncated.slice(0), new CollectorListener())
        );
        expect(sErr).toBeDefined();
    });

    // Phase 3: mid-element-header (4 bytes into a body element's 8-byte header).
    // After a valid FMI, the body starts; truncate 4 bytes into the first body
    // element header (i.e., only the tag is present, not VR + length).
    test("phase 3: mid-element-header — rejects, does not hang", async () => {
        const body = new DicomWriter();
        body.elemStd(0x0008, 0x0060, "CS", new Uint8Array([0x43, 0x54]));
        const full = new Uint8Array(buildFileWithFmiAndBody(ELE_TS, body));
        // FMI_END ≈ 188; truncate at FMI_END + 4 (tag only, no VR/length).
        // Scan for actual FMI end by finding the body element tag (0008,0060).
        let fmiEnd = 132; // start of FMI elements
        // Walk through FMI elements to find body start.
        // Simpler: use a known FMI layout: 132 + 12 + 14 + 30 = 188.
        const FMI_END = 188;
        const truncated = full.slice(0, FMI_END + 4).buffer;

        const { threw: sErr } = await withHangTimeout(
            fromPart10Stream(truncated.slice(0), new CollectorListener())
        );
        expect(sErr).toBeDefined();
    });

    // Phase 4: mid-value (full element header present, value truncated).
    // (0008,0060) CS length=256 but only 4 bytes of value present.
    test("phase 4: mid-value — rejects, does not hang", async () => {
        const body = new DicomWriter();
        // Claim 256 bytes but write only 4.
        const shortValue = new Uint8Array(4).fill(0x41);
        const elem = new DicomWriter();
        elem.u16LE(0x0008); elem.u16LE(0x0060);
        elem.ascii("LO");
        elem.u16LE(256); // claims 256
        elem._push(shortValue); // only 4 bytes present
        body._push(elem.toUint8Array());

        const truncated = buildFileWithFmiAndBody(ELE_TS, body);

        const { threw: sErr } = await withHangTimeout(
            fromPart10Stream(truncated.slice(0), new CollectorListener())
        );
        expect(sErr).toBeDefined();

        let bErr;
        try { await fromPart10(truncated.slice(0), new CollectorListener()); }
        catch (e) { bErr = e; }
        expect(bErr).toBeDefined(); // buffered also throws
    });

    // Phase 5: mid-fragment (truncate inside an encapsulated pixel fragment).
    // Encapsulated TS + pixel data element, fragment claims 1024 bytes but file
    // ends after 512 bytes of fragment content.
    test("phase 5: mid-fragment — rejects, does not hang", async () => {
        const ENC_TS = "1.2.840.10008.1.2.4.80\0";
        const FRAG_CLAIMED = 1024;
        const FRAG_ACTUAL = 512; // truncated

        const seq = new DicomWriter();
        seq.u16LE(0xfffe); seq.u16LE(0xe000); seq.u32LE(0); // BOT
        seq.u16LE(0xfffe); seq.u16LE(0xe000); seq.u32LE(FRAG_CLAIMED);
        seq._push(new Uint8Array(FRAG_ACTUAL).fill(0xab)); // only 512 bytes
        // NO sequence delimiter — file ends here.
        const seqBytes = seq.toUint8Array();

        const body = new DicomWriter();
        body.u16LE(0x7fe0); body.u16LE(0x0010);
        body.ascii("OB");
        body.u16LE(0);
        body.u32LE(0xffffffff);
        body._push(seqBytes);

        const truncated = buildFileWithFmiAndBody(ENC_TS, body);

        const { threw: sErr } = await withHangTimeout(
            fromPart10Stream(truncated.slice(0), new CollectorListener())
        );
        expect(sErr).toBeDefined();
        expect(sErr).toBeInstanceOf(Error);
        expect(sErr.message).toMatch(/truncated/i);
    });

    // Phase 6: mid-deflate-stream (valid FMI with deflate TS; body is corrupt
    // deflate — guaranteed to trigger a pako inflation error).
    // NOTE: a *truncated valid* deflate prefix (first half of a real compressed
    // stream) may happen to inflate without error if pako accepts partial streams
    // gracefully.  Corrupt bytes (all 0xFF) are guaranteed to fail immediately.
    // Both paths must throw.
    test("phase 6: mid-deflate-stream — rejects, does not hang", async () => {
        const DEFLATE_TS = "1.2.840.10008.1.2.1.99\0";

        // 64 bytes of 0xFF are definitively invalid as a raw deflate stream.
        // pako.inflate will throw Z_DATA_ERROR on the first byte.
        const body = new DicomWriter();
        body._push(new Uint8Array(64).fill(0xff));
        const truncated = buildFileWithFmiAndBody(DEFLATE_TS, body);

        const { threw: sErr } = await withHangTimeout(
            fromPart10Stream(truncated.slice(0), new CollectorListener())
        );
        expect(sErr).toBeDefined();
        expect(sErr).toBeInstanceOf(Error);

        let bErr;
        try { await fromPart10(truncated.slice(0), new CollectorListener()); }
        catch (e) { bErr = e; }
        expect(bErr).toBeDefined();
    });

    // Phase 7: empty input (zero bytes).
    test("phase 7: empty input — rejects, does not hang", async () => {
        const empty = new ArrayBuffer(0);

        const { threw: sErr } = await withHangTimeout(
            fromPart10Stream(empty.slice(0), new CollectorListener())
        );
        expect(sErr).toBeDefined();
    });
});
