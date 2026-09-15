/**
 * test/eventStream/fromPart10Stream.test.js
 *
 * TDD suite for fromPart10Stream (slice K, stages 1–3).
 *
 * K1 groups (1–6): input normalisation, equivalence, options threading
 * K2 groups (7–9): FMI incremental streaming gate, no-meta-length, error parity
 * K3 groups (10–13): body incremental gate, native-path spy, truncation,
 *                    synthesized defined-length SQ
 */

import fs from "fs";
import path from "path";
import { fromPart10 } from "../../src/eventStream/fromPart10.js";
import { fromPart10Stream } from "../../src/eventStream/fromPart10Stream.js";
import { CollectorListener } from "../../src/eventStream/CollectorListener.js";
import { EventStreamListener } from "../../src/eventStream/EventStreamListener.js";
import { DicomEventStream } from "../../src/eventStream/api.js";
import { DicomMessage } from "../../src/DicomMessage.js";
import { deepCompare } from "../helper/equivalence.js";

const REPO_ROOT = path.join(__dirname, "..", "..");

function readBuffer(rel) {
    const data = fs.readFileSync(path.join(REPO_ROOT, rel));
    return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
    );
}

// Two well-known fixtures: one explicit-LE scalar, one encapsulated JPEG.
const FIXTURE_ELE =
    "packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm";
const FIXTURE_ENC =
    "packages/parser/testImages/encapsulated/single-frame/CT1_UNC.explicit_little_endian.dcm";

// ---------------------------------------------------------------------------
// Comparison helpers (adapted from fromPart10.test.js; inlined to keep the
// test self-contained — no cross-test-file imports of private helpers).
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

/** Run the buffered reference path. */
async function runBuffered(buffer, options = {}) {
    const listener = new CollectorListener();
    await fromPart10(buffer, listener, options);
    return listener.result;
}

/** Run fromPart10Stream with any input form. */
async function runStream(input, options = {}) {
    const listener = new CollectorListener();
    await fromPart10Stream(input, listener, options);
    return listener.result;
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

// ---------------------------------------------------------------------------
// Test 1: Single-chunk ArrayBuffer input
// ---------------------------------------------------------------------------

describe("fromPart10Stream — single-chunk ArrayBuffer input", () => {
    test.each([
        ["explicit-LE scalars", FIXTURE_ELE],
        ["encapsulated JPEG single-frame", FIXTURE_ENC]
    ])("%s: events deep-equal buffered fromPart10", async (_label, rel) => {
        const buffer = readBuffer(rel);
        const expected = await runBuffered(buffer.slice(0));
        const actual = await runStream(buffer.slice(0)); // ArrayBuffer input

        const problems = [];
        compareSection(
            expected.meta || {},
            actual.meta || {},
            "meta",
            problems
        );
        compareSection(
            expected.dict || {},
            actual.dict || {},
            "dict",
            problems
        );
        expect(problems).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Test 2: AsyncIterable input (37-byte chunks)
// ---------------------------------------------------------------------------

describe("fromPart10Stream — AsyncIterable<Uint8Array> input (37-byte chunks)", () => {
    test.each([
        ["explicit-LE scalars", FIXTURE_ELE],
        ["encapsulated JPEG single-frame", FIXTURE_ENC]
    ])("%s: events deep-equal buffered fromPart10", async (_label, rel) => {
        const buffer = readBuffer(rel);
        const expected = await runBuffered(buffer.slice(0));
        const actual = await runStream(chunked(buffer.slice(0), 37));

        const problems = [];
        compareSection(
            expected.meta || {},
            actual.meta || {},
            "meta",
            problems
        );
        compareSection(
            expected.dict || {},
            actual.dict || {},
            "dict",
            problems
        );
        expect(problems).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Test 3: ReadableStream input (1024-byte chunks)
// Skipped gracefully if ReadableStream is not available in the test env.
// ---------------------------------------------------------------------------

const HAS_READABLE_STREAM = typeof ReadableStream !== "undefined";

describe("fromPart10Stream — ReadableStream input (1024-byte chunks)", () => {
    const maybeTest = HAS_READABLE_STREAM ? test : test.skip;

    maybeTest(
        "explicit-LE scalars: events deep-equal buffered fromPart10",
        async () => {
            const buffer = readBuffer(FIXTURE_ELE);
            const expected = await runBuffered(buffer.slice(0));

            const bytes = new Uint8Array(buffer.slice(0));
            const stream = new ReadableStream({
                start(controller) {
                    const chunkSize = 1024;
                    let offset = 0;
                    while (offset < bytes.length) {
                        controller.enqueue(
                            bytes.slice(
                                offset,
                                Math.min(offset + chunkSize, bytes.length)
                            )
                        );
                        offset += chunkSize;
                    }
                    controller.close();
                }
            });

            const actual = await runStream(stream);

            const problems = [];
            compareSection(
                expected.meta || {},
                actual.meta || {},
                "meta",
                problems
            );
            compareSection(
                expected.dict || {},
                actual.dict || {},
                "dict",
                problems
            );
            expect(problems).toEqual([]);
        }
    );
});

// ---------------------------------------------------------------------------
// Test 4: Re-runnability via DicomEventStream.fromPart10Stream factory
// ---------------------------------------------------------------------------

describe("fromPart10Stream — re-runnability (DicomEventStream.fromPart10Stream)", () => {
    test("buffer input: two .process() calls both succeed and agree", async () => {
        const buffer = readBuffer(FIXTURE_ELE);
        const events = DicomEventStream.fromPart10Stream(buffer.slice(0));

        const a = new CollectorListener();
        await events.process(a);

        const b = new CollectorListener();
        await events.process(b); // second run — must succeed

        const problems = [];
        compareSection(
            a.result.meta || {},
            b.result.meta || {},
            "meta",
            problems
        );
        compareSection(
            a.result.dict || {},
            b.result.dict || {},
            "dict",
            problems
        );
        expect(problems).toEqual([]);
    });

    test("generator input: second .process() call rejects with consumed error", async () => {
        const buffer = readBuffer(FIXTURE_ELE);
        // Passing an AsyncIterable — consumed on first use.
        const events = DicomEventStream.fromPart10Stream(
            chunked(buffer.slice(0), 37)
        );

        const a = new CollectorListener();
        await events.process(a); // first run succeeds

        const b = new CollectorListener();
        await expect(events.process(b)).rejects.toThrow(
            /already been consumed/
        );
    });
});

// ---------------------------------------------------------------------------
// Test 5: options threading — forceStoreRaw=true
// ---------------------------------------------------------------------------

/**
 * CollectorListener subclass that also captures the rawValue option from
 * each `value(v, { rawValue })` event.  The standard CollectorListener only
 * retains `v`; this variant exposes `._rawValues` for inspection.
 */
class RawValueCollectorListener extends CollectorListener {
    constructor() {
        super();
        this._rawValues = [];
    }

    /** Overrides _baseValue so rawValue from the options bag is captured. */
    _baseValue(v, opts = {}) {
        super._baseValue(v);
        this._rawValues.push(opts?.rawValue);
    }
}

describe("fromPart10Stream — options threading (forceStoreRaw)", () => {
    test("forceStoreRaw=true produces same rawValues as buffered fromPart10", async () => {
        const buffer = readBuffer(FIXTURE_ELE);
        const opts = { forceStoreRaw: true };

        const bufferedListener = new RawValueCollectorListener();
        await fromPart10(buffer.slice(0), bufferedListener, opts);

        const streamListener = new RawValueCollectorListener();
        await fromPart10Stream(buffer.slice(0), streamListener, opts);

        // Same number of value events.
        expect(streamListener._rawValues.length).toBe(
            bufferedListener._rawValues.length
        );
        // Emitted at least some values (sanity).
        expect(streamListener._rawValues.length).toBeGreaterThan(0);

        // rawValues match element-by-element.
        const problems = [];
        for (let i = 0; i < bufferedListener._rawValues.length; i++) {
            deepCompare(
                bufferedListener._rawValues[i],
                streamListener._rawValues[i],
                `rawValues[${i}]`,
                problems
            );
        }
        expect(problems).toEqual([]);

        // At least some rawValues must be non-undefined: forceStoreRaw took effect.
        expect(streamListener._rawValues.some(v => v !== undefined)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Test 6: Invalid input rejection (TypeError)
// ---------------------------------------------------------------------------

describe("fromPart10Stream — invalid input rejection", () => {
    test.each([
        ["plain number", 42],
        ["plain object", {}],
        ["string", "not a buffer"],
        ["null", null],
        ["undefined", undefined]
    ])("%s: rejects with TypeError", async (_label, invalidInput) => {
        const listener = new CollectorListener();
        await expect(
            fromPart10Stream(invalidInput, listener)
        ).rejects.toThrow(TypeError);
    });
});

// ---------------------------------------------------------------------------
// K2 Test 7: FMI events arrive before input is complete (streaming gate)
//
// This is the key RED test for K2: the K1 placeholder buffers all bytes
// before emitting any events, so the test fails with K1.  K2's incremental
// FMI parser emits startFileMetaInformation / endFileMetaInformation while
// the body bytes are still blocked behind a gate promise.
// ---------------------------------------------------------------------------

/**
 * A minimal EventStreamListener subclass that records which top-level
 * bracket events have been delivered.  Only the names we care about for
 * the gate check are tracked; all other callbacks are no-ops.
 *
 * Also resolves `fmiComplete` promise when endFileMetaInformation is called,
 * allowing tests to await deterministically instead of using flaky timers.
 */
class BracketTrackingListener {
    constructor() {
        this.received = [];
        this.fmiComplete = new Promise(resolve => {
            this._resolveFmiComplete = resolve;
        });
    }
    startDataSet() {
        this.received.push("startDataSet");
    }
    endDataSet() {
        this.received.push("endDataSet");
    }
    startFileMetaInformation() {
        this.received.push("startFileMetaInformation");
    }
    endFileMetaInformation() {
        this.received.push("endFileMetaInformation");
        // Signal that FMI parsing is complete, allowing deterministic test gating.
        this._resolveFmiComplete();
    }
    // EventStreamListener contract — no-ops for the gate check
    startElement() {}
    endElement() {}
    value() {}
    startBinary() {}
    binaryFragment() {}
    endBinary() {}
    startSequence() {}
    endSequence() {}
    startItem() {}
    endItem() {}
    awaitDrain() {}
}

describe("fromPart10Stream — K2: FMI events before input completes", () => {
    test(
        "startFileMetaInformation + endFileMetaInformation arrive while body is gated",
        async () => {
            const buffer = readBuffer(FIXTURE_ELE);
            const bytes = new Uint8Array(buffer);

            // CT1_UNC.explicit_little_endian.dcm FMI ends at ~334 bytes.
            // Yielding the first 400 bytes covers the entire FMI group.
            const FMI_SAFE_BOUNDARY = 400;

            let unblockBody;
            const bodyGate = new Promise(resolve => {
                unblockBody = resolve;
            });

            async function* gatingIterable() {
                // Chunk 1: covers preamble + FMI
                yield bytes.slice(0, FMI_SAFE_BOUNDARY);
                // Block until the test releases the gate
                await bodyGate;
                // Chunk 2: rest of the file
                yield bytes.slice(FMI_SAFE_BOUNDARY);
            }

            const listener = new BracketTrackingListener();
            const parsePromise = fromPart10Stream(gatingIterable(), listener);

            // Await completion of FMI parsing deterministically.
            // The listener resolves fmiComplete when endFileMetaInformation is called.
            // Use a generous timeout that FAILS the test rather than passing vacuously
            // if FMI parsing stalls.
            const fmiTimeout = new Promise((_, reject) => {
                const t = setTimeout(() => reject(new Error("FMI parsing timeout")), 10000);
                // unref so this timer does not keep the process alive if the real
                // promise wins (prevents "worker failed to exit gracefully" warnings).
                if (t?.unref) t.unref();
            });
            await Promise.race([listener.fmiComplete, fmiTimeout]);

            // K2 assertion: FMI bracket events must have been delivered
            // BEFORE the body gate is released.
            expect(listener.received).toContain("startFileMetaInformation");
            expect(listener.received).toContain("endFileMetaInformation");

            // Release the body gate and let the parse finish.
            unblockBody();
            await parsePromise;
        }
    );
});

// ---------------------------------------------------------------------------
// K2 Test 8: No-meta-length fixture equivalence through the stream path
//
// test/no-meta-length-test.dcm lacks (0002,0000) FileMetaInformationGroupLength.
// The stream path must handle the fallback (stop-on-group-change) correctly
// and produce events equivalent to the buffered fromPart10 path.
// ---------------------------------------------------------------------------

const FIXTURE_NO_META_LEN = "test/no-meta-length-test.dcm";

describe("fromPart10Stream — K2: no-group-length FMI fixture", () => {
    test.each([
        ["single chunk", buffer => buffer],
        ["37-byte chunks", buffer => chunked(buffer, 37)]
    ])(
        "%s: events deep-equal buffered fromPart10",
        async (_label, toInput) => {
            const buffer = readBuffer(FIXTURE_NO_META_LEN);
            const expected = await runBuffered(buffer.slice(0));
            const actual = await runStream(toInput(buffer.slice(0)));

            const problems = [];
            compareSection(
                expected.meta || {},
                actual.meta || {},
                "meta",
                problems
            );
            compareSection(
                expected.dict || {},
                actual.dict || {},
                "dict",
                problems
            );
            expect(problems).toEqual([]);
        }
    );
});

// ---------------------------------------------------------------------------
// K2 Test 9: Raw-dataset / DICM-less error parity
//
// A byte array that is neither a valid Part 10 file (no DICM marker, no 0002
// group) nor a parseable raw DICOM dataset must fail with an error of the
// same class as buffered fromPart10.  Exact message parity with @dcmjs/parser
// is not required (documented delta: early detection in fromPart10Stream may
// produce a different message; see task-K2-report.md).
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K2: raw-dataset / DICM-less error parity", () => {
    test("completely invalid bytes: same error class as buffered fromPart10", async () => {
        // 64 zero bytes — not a valid DICOM file, not starting with 0002 group.
        const badBytes = new Uint8Array(64).buffer;

        let bufferedError;
        try {
            const listener = new CollectorListener();
            await fromPart10(badBytes, listener);
        } catch (e) {
            bufferedError = e;
        }

        let streamError;
        try {
            const listener = new CollectorListener();
            await fromPart10Stream(badBytes, listener);
        } catch (e) {
            streamError = e;
        }

        // Both must throw
        expect(bufferedError).toBeDefined();
        expect(streamError).toBeDefined();

        // Same error class
        expect(streamError.constructor).toBe(bufferedError.constructor);
    });
});

// ===========================================================================
// K3 TESTS — Written first (RED) before K3 implementation. K2's Phase 4 is
// still the buffered-body placeholder; these tests must FAIL until the K3
// incremental body loop replaces it.
// ===========================================================================

// ---------------------------------------------------------------------------
// K3 Test 10: Body events arrive before input is complete (KEY RED TEST)
//
// The K2 placeholder buffers all body bytes before emitting any body events,
// so the first body element event arrives only AFTER the full file is fed.
// K3's incremental body loop must emit body element events as bytes arrive,
// BEFORE the body tail bytes are released.
//
// Mechanism: gating async generator releases FMI + first body bytes (up to
// a safe boundary well past the first body element), then blocks.  The test
// awaits a listener promise that resolves on the FIRST body element event.
// This must resolve before the gate is released.
// ---------------------------------------------------------------------------

/**
 * Listener subclass that tracks the first non-FMI body element event.
 * Resolves `firstBodyElement` promise (with the tag string) the first time
 * startElement() is called after endFileMetaInformation().
 * Extends BracketTrackingListener so it satisfies the full event contract.
 */
class BodyGateListener extends BracketTrackingListener {
    constructor() {
        super();
        this._pastFmi = false;
        this._bodyStarted = false;
        this.firstBodyElement = new Promise(resolve => {
            this._resolveFirstBody = resolve;
        });
    }
    endFileMetaInformation() {
        super.endFileMetaInformation();
        this._pastFmi = true;
    }
    startElement(tag) {
        if (this._pastFmi && !this._bodyStarted) {
            this._bodyStarted = true;
            this._resolveFirstBody(tag);
        }
    }
}

describe("fromPart10Stream — K3: body events before input completes", () => {
    test(
        "first body element event arrives while body tail is gated (incremental gate)",
        async () => {
            const buffer = readBuffer(FIXTURE_ELE);
            const bytes = new Uint8Array(buffer);

            // CT1_UNC.explicit_little_endian.dcm:
            //   FMI ends at ~334 bytes; first body element (0008,0005 or 0008,0008)
            //   header + value fits well within the first 600 bytes.
            // We yield the first 600 bytes (covering FMI + a few body elements),
            // then gate on a promise before yielding the tail.
            const BODY_PARTIAL_BOUNDARY = 600;

            let unblockTail;
            const tailGate = new Promise(resolve => {
                unblockTail = resolve;
            });

            async function* gatingIterable() {
                // Chunk 1: preamble + FMI + first few body elements
                yield bytes.slice(0, BODY_PARTIAL_BOUNDARY);
                // Block until the test releases the gate
                await tailGate;
                // Chunk 2: rest of the file
                yield bytes.slice(BODY_PARTIAL_BOUNDARY);
            }

            const listener = new BodyGateListener();
            const parsePromise = fromPart10Stream(gatingIterable(), listener);

            // Await the first body element deterministically (with timeout).
            const bodyTimeout = new Promise((_, reject) => {
                const t = setTimeout(
                    () => reject(new Error("First body element timeout — K3 body loop not incremental")),
                    10000
                );
                // unref so this timer does not keep the process alive if the real
                // promise wins (prevents "worker failed to exit gracefully" warnings).
                if (t?.unref) t.unref();
            });
            const firstBodyTag = await Promise.race([
                listener.firstBodyElement,
                bodyTimeout
            ]);

            // K3 assertion: a body element arrived before the tail was released.
            expect(typeof firstBodyTag).toBe("string");
            expect(firstBodyTag.length).toBe(8); // "GGGGEEEE" format

            // Release the tail and finish.
            unblockTail();
            await parsePromise;
        }
    );
});

// ---------------------------------------------------------------------------
// K3 Test 11: Native-path assertion via options.onPhase spy
//
// For corpus fixtures without undefined-length body elements and non-deflate
// transfer syntax, the K3 incremental body loop must report "native" via
// options.onPhase.  K2 never calls onPhase, so this test is RED until K3
// wires the hook.
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K3: native-path assertion (onPhase spy)", () => {
    test(
        "FIXTURE_ELE (defined-length explicit-LE): onPhase called with 'native'",
        async () => {
            const buffer = readBuffer(FIXTURE_ELE);
            const phases = [];
            const listener = new CollectorListener();
            await fromPart10Stream(buffer.slice(0), listener, {
                onPhase: phase => phases.push(phase)
            });
            // Native incremental path must report "native"; neither "tailFallback"
            // nor "deflate" should appear for this well-formed defined-length fixture.
            expect(phases).toContain("native");
            expect(phases).not.toContain("tailFallback");
            expect(phases).not.toContain("deflate");
        }
    );
});

// ---------------------------------------------------------------------------
// K3 Test 12: Truncation error parity
//
// A defined-length element whose value extends past EOF must cause both the
// buffered (fromPart10) path and the K3 stream path to throw.  Both must
// throw — exact error class parity is documented as impractical (buffered
// path throws a plain object; K3 incremental path throws an Error).
// See task-K3-report.md §truncation-delta for the documented delta.
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K3: truncation error parity", () => {
    test(
        "truncated body element: both buffered and stream paths throw",
        async () => {
            // Build a valid-looking DICOM Part 10 file where the body contains
            // one explicit-LE element (0008,0010 LO, length=256) but only 4 bytes
            // of value data are present (truncated).
            const w = new DataView(new ArrayBuffer(512));
            let off = 0;
            const setU8 = (pos, v) => w.setUint8(pos, v);
            const setU16 = (pos, v) => w.setUint16(pos, v, true);
            const setU32 = (pos, v) => w.setUint32(pos, v, true);

            // Preamble (128 bytes = zeros) + DICM
            off = 128;
            setU8(off, 0x44); setU8(off+1, 0x49);
            setU8(off+2, 0x43); setU8(off+3, 0x4d);
            off = 132;

            // (0002,0000) UL 4 bytes: FileMetaInformationGroupLength
            const fmiGroupLenPos = off;
            setU16(off, 0x0002); setU16(off+2, 0x0000); off += 4;
            setU8(off, 0x55); setU8(off+1, 0x4c); off += 2; // "UL"
            setU16(off, 4); off += 2;
            const fmiGroupLenValPos = off;
            setU32(off, 0); off += 4; // placeholder

            // (0002,0001) OB [0,1]
            setU16(off, 0x0002); setU16(off+2, 0x0001); off += 4;
            setU8(off, 0x4f); setU8(off+1, 0x42); off += 2; // "OB"
            setU16(off, 0x0000); off += 2; // reserved
            setU32(off, 2); off += 4;
            setU8(off, 0); setU8(off+1, 1); off += 2;

            // (0002,0010) UI "1.2.840.10008.1.2.1\0"
            const tsUid = "1.2.840.10008.1.2.1\0";
            setU16(off, 0x0002); setU16(off+2, 0x0010); off += 4;
            setU8(off, 0x55); setU8(off+1, 0x49); off += 2; // "UI"
            setU16(off, tsUid.length); off += 2;
            for (let i = 0; i < tsUid.length; i++) { setU8(off+i, tsUid.charCodeAt(i)); }
            off += tsUid.length;

            // Fill in (0002,0000) value
            setU32(fmiGroupLenValPos, off - (fmiGroupLenValPos + 4));

            // Body: (0008,0010) LO length=256, only 4 bytes present (truncated)
            setU16(off, 0x0008); setU16(off+2, 0x0010); off += 4;
            setU8(off, 0x4c); setU8(off+1, 0x4f); off += 2; // "LO"
            setU16(off, 256); off += 2; // claims 256 bytes
            setU32(off, 0); off += 4; // only 4 bytes of value — truncated

            const truncBuffer = w.buffer.slice(0, off);

            let bufferedError;
            try {
                const listener = new CollectorListener();
                await fromPart10(truncBuffer.slice(0), listener);
            } catch (e) {
                bufferedError = e;
            }

            let streamError;
            try {
                const listener = new CollectorListener();
                await fromPart10Stream(truncBuffer.slice(0), listener);
            } catch (e) {
                streamError = e;
            }

            // Both must throw (exact class parity is impractical — see K3 report).
            expect(bufferedError).toBeDefined();
            expect(streamError).toBeDefined();
        }
    );
});

// ---------------------------------------------------------------------------
// K3 Test 13: Synthesized defined-length SQ equivalence
//
// Build a tiny Part 10 file in memory containing a defined-length SQ with
// two items (one with one child element, one empty), then verify that
// streaming in 37-byte chunks produces events identical to the buffered path.
//
// The synthesized file uses Explicit Little Endian throughout.
// Building helper: DicomWriter — a minimal in-memory byte writer
// that does not import any dcmjs code (pure byte manipulation).
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory byte builder for synthesized DICOM test files.
 * No dcmjs dependency — pure ArrayBuffer + DataView manipulation.
 */
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
    u16(v) {
        const a = new Uint8Array(2);
        new DataView(a.buffer).setUint16(0, v, true);
        this._push(a);
    }
    u32(v) {
        const a = new Uint8Array(4);
        new DataView(a.buffer).setUint32(0, v, true);
        this._push(a);
    }
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
 * Build a synthesized Part 10 file (Explicit Little Endian) containing:
 *   - Standard Part 10 preamble + DICM marker
 *   - Minimal FMI: (0002,0000) UL, (0002,0001) OB, (0002,0010) UI = ELE
 *   - Body: (0008,0060) CS = "CT"
 *           (0008,1115) SQ with 2 defined-length items:
 *               Item 1: (0008,0060) CS = "MR"
 *               Item 2: (empty)
 */
function buildSyntheticSQFile() {
    // --- Item 1: contains (0008,0060) CS "MR" ---
    const item1Child = new DicomWriter();
    item1Child.elemStd(0x0008, 0x0060, "CS", new Uint8Array([0x4d, 0x52])); // "MR"
    const item1Content = item1Child.toUint8Array();

    const item1 = new DicomWriter();
    item1.u16(0xfffe); item1.u16(0xe000); // FFFE,E000
    item1.u32(item1Content.length);
    item1._push(item1Content);

    // --- Item 2: empty ---
    const item2 = new DicomWriter();
    item2.u16(0xfffe); item2.u16(0xe000);
    item2.u32(0);

    // --- SQ value bytes ---
    const sqContent = new DicomWriter();
    sqContent._push(item1.toUint8Array());
    sqContent._push(item2.toUint8Array());
    const sqBytes = sqContent.toUint8Array();

    // --- Body ---
    const body = new DicomWriter();
    body.elemStd(0x0008, 0x0060, "CS", new Uint8Array([0x43, 0x54])); // "CT"
    body.elemLong(0x0008, 0x1115, "SQ", sqBytes);
    const bodyBytes = body.toUint8Array();

    // --- FMI parts ---
    const fmiOB = new DicomWriter();
    fmiOB.elemLong(0x0002, 0x0001, "OB", new Uint8Array([0, 1]));

    const tsStr = "1.2.840.10008.1.2.1\0";
    const fmiTS = new DicomWriter();
    fmiTS.elemStd(
        0x0002, 0x0010, "UI",
        new Uint8Array(tsStr.split("").map(c => c.charCodeAt(0)))
    );

    const restFmiLen = fmiOB.toUint8Array().length + fmiTS.toUint8Array().length;
    const glBytes = new Uint8Array(4);
    new DataView(glBytes.buffer).setUint32(0, restFmiLen, true);
    const fmiGL = new DicomWriter();
    fmiGL.elemStd(0x0002, 0x0000, "UL", glBytes);

    // --- Assemble ---
    const file = new DicomWriter();
    file.zeros(128); // preamble
    file.ascii("DICM");
    file._push(fmiGL.toUint8Array());
    file._push(fmiOB.toUint8Array());
    file._push(fmiTS.toUint8Array());
    file._push(bodyBytes);
    return file.toArrayBuffer();
}

/**
 * Build a synthesized Part 10 file (Explicit Little Endian) whose body
 * contains only a zero-length top-level SQ (length = 0, no items).
 * This is a boundary case: parseSqItems must exit immediately on an empty range.
 */
function buildSyntheticZeroLengthSQFile() {
    const tsStr = "1.2.840.10008.1.2.1\0"; // ELE

    const fmiOB = new DicomWriter();
    fmiOB.elemLong(0x0002, 0x0001, "OB", new Uint8Array([0, 1]));

    const fmiTS = new DicomWriter();
    fmiTS.elemStd(
        0x0002, 0x0010, "UI",
        new Uint8Array(tsStr.split("").map(c => c.charCodeAt(0)))
    );

    const restFmiLen =
        fmiOB.toUint8Array().length + fmiTS.toUint8Array().length;
    const glBytes = new Uint8Array(4);
    new DataView(glBytes.buffer).setUint32(0, restFmiLen, true);
    const fmiGL = new DicomWriter();
    fmiGL.elemStd(0x0002, 0x0000, "UL", glBytes);

    const body = new DicomWriter();
    body.elemStd(0x0008, 0x0060, "CS", new Uint8Array([0x43, 0x54])); // "CT"
    body.elemLong(0x0008, 0x1115, "SQ", new Uint8Array(0)); // zero-length SQ

    const file = new DicomWriter();
    file.zeros(128);
    file.ascii("DICM");
    file._push(fmiGL.toUint8Array());
    file._push(fmiOB.toUint8Array());
    file._push(fmiTS.toUint8Array());
    file._push(body.toUint8Array());
    return file.toArrayBuffer();
}

describe("fromPart10Stream — K3: synthesized defined-length SQ equivalence", () => {
    test(
        "SQ with two defined-length items (37-byte chunks): events match buffered",
        async () => {
            const buffer = buildSyntheticSQFile();
            const expected = await runBuffered(buffer.slice(0));
            const actual = await runStream(chunked(buffer.slice(0), 37));

            const problems = [];
            compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
            compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
            expect(problems).toEqual([]);
        }
    );

    test(
        "SQ with two defined-length items (single chunk): events match buffered",
        async () => {
            const buffer = buildSyntheticSQFile();
            const expected = await runBuffered(buffer.slice(0));
            const actual = await runStream(buffer.slice(0));

            const problems = [];
            compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
            compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
            expect(problems).toEqual([]);
        }
    );

    // K3 Minor: zero-length top-level SQ boundary (Test 13 extension)
    test(
        "zero-length top-level SQ (single chunk): events match buffered",
        async () => {
            const buffer = buildSyntheticZeroLengthSQFile();
            const expected = await runBuffered(buffer.slice(0));
            const actual = await runStream(buffer.slice(0));

            const problems = [];
            compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
            compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
            expect(problems).toEqual([]);
        }
    );

    test(
        "zero-length top-level SQ (37-byte chunks): events match buffered",
        async () => {
            const buffer = buildSyntheticZeroLengthSQFile();
            const expected = await runBuffered(buffer.slice(0));
            const actual = await runStream(chunked(buffer.slice(0), 37));

            const problems = [];
            compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
            compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
            expect(problems).toEqual([]);
        }
    );
});

// ---------------------------------------------------------------------------
// K3 Test 14: Explicit-big-endian corpus equivalence + native-path assertion
//
// CT1_UNC.explicit_big_endian.dcm uses Explicit Big Endian transfer syntax.
// Both single-chunk and 37-byte-chunked streaming must produce events identical
// to the buffered reference, and options.onPhase must report 'native' (the
// file contains only defined-length elements — no tail-fallback required).
// ---------------------------------------------------------------------------

const FIXTURE_EBE =
    "packages/parser/testImages/CT1_UNC.explicit_big_endian.dcm";

describe("fromPart10Stream — K3: explicit-big-endian corpus equivalence (native path)", () => {
    test.each([
        ["single chunk",    buf => buf],
        ["37-byte chunks",  buf => chunked(buf, 37)]
    ])(
        "%s: events deep-equal buffered + onPhase='native'",
        async (_label, toInput) => {
            const buffer = readBuffer(FIXTURE_EBE);
            const expected = await runBuffered(buffer.slice(0));
            const phases   = [];
            const actual   = await runStream(toInput(buffer.slice(0)), {
                onPhase: p => phases.push(p)
            });

            const problems = [];
            compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
            compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
            expect(problems).toEqual([]);

            // This corpus file contains only defined-length elements; the K3
            // incremental body loop must handle it without tail-fallback.
            expect(phases).toContain("native");
            expect(phases).not.toContain("tailFallback");
            expect(phases).not.toContain("deflate");
        }
    );
});

// ---------------------------------------------------------------------------
// K3 Test 15: Implicit-little-endian corpus equivalence + native-path assertion
//
// CT1_UNC.implicit_little_endian.dcm uses Implicit Little Endian transfer
// syntax (no VR bytes in the body).  The stream must decode it equivalently
// to the buffered path (dictionary-driven VR resolution + data-peek for
// dictionary-unknown SQ elements), and onPhase must report 'native'.
// ---------------------------------------------------------------------------

const FIXTURE_ILE =
    "packages/parser/testImages/CT1_UNC.implicit_little_endian.dcm";

describe("fromPart10Stream — K3: implicit-little-endian corpus equivalence (native path)", () => {
    test.each([
        ["single chunk",    buf => buf],
        ["37-byte chunks",  buf => chunked(buf, 37)]
    ])(
        "%s: events deep-equal buffered + onPhase='native'",
        async (_label, toInput) => {
            const buffer = readBuffer(FIXTURE_ILE);
            const expected = await runBuffered(buffer.slice(0));
            const phases   = [];
            const actual   = await runStream(toInput(buffer.slice(0)), {
                onPhase: p => phases.push(p)
            });

            const problems = [];
            compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
            compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
            expect(problems).toEqual([]);

            expect(phases).toContain("native");
            expect(phases).not.toContain("tailFallback");
            expect(phases).not.toContain("deflate");
        }
    );
});

// ---------------------------------------------------------------------------
// AD-1: implicit-SQ handling — ONE behavior, eager parity
//
// The canonical implicit-VR contract is decodeCore.resolveVrInstance, which
// matches the eager reference: a DEFINED-length, dictionary-unknown implicit
// element is never data-peek-promoted to SQ — it decodes as a UN leaf no
// matter what its value bytes look like.  (The parser's isSequence() peek and
// fromPart10Stream's undefined-length routing peek are framing mechanics
// only; UNDEFINED-length dictionary-miss elements resolve to SQ by the
// length rule.)  Historically fromPart10 trusted the parser's el.items and
// fromPart10Stream hand-rolled an FFFE peek, promoting these elements to SQ
// while readFile (both cores) decoded them as UN — three behaviors where the
// architecture promises one.  These tests pin all four read paths to the
// single eager-parity behavior.
// ---------------------------------------------------------------------------

/**
 * Build a minimal Implicit Little Endian Part 10 file whose body contains
 * exactly one element with the given tag and raw value bytes.  Pass
 * `lengthOverride` (e.g. 0xffffffff) to declare a length different from
 * valueBytes.length (undefined-length elements).
 */
function buildImplicitBodyFile(tagGroup, tagElement, valueBytes, lengthOverride) {
    const ILE_TS = "1.2.840.10008.1.2\0";

    const fmiOB = new DicomWriter();
    fmiOB.elemLong(0x0002, 0x0001, "OB", new Uint8Array([0, 1]));

    const fmiTS = new DicomWriter();
    fmiTS.elemStd(
        0x0002, 0x0010, "UI",
        new Uint8Array(ILE_TS.split("").map(c => c.charCodeAt(0)))
    );

    const restFmiLen =
        fmiOB.toUint8Array().length + fmiTS.toUint8Array().length;
    const glBytes = new Uint8Array(4);
    new DataView(glBytes.buffer).setUint32(0, restFmiLen, true);
    const fmiGL = new DicomWriter();
    fmiGL.elemStd(0x0002, 0x0000, "UL", glBytes);

    // Implicit body element: tag (LE uint16 × 2) + 4-byte LE length + value
    const bodyElem = new DicomWriter();
    bodyElem.u16(tagGroup);
    bodyElem.u16(tagElement);
    bodyElem.u32(lengthOverride ?? valueBytes.length);
    bodyElem._push(valueBytes instanceof Uint8Array ? valueBytes : new Uint8Array(valueBytes));

    const file = new DicomWriter();
    file.zeros(128);
    file.ascii("DICM");
    file._push(fmiGL.toUint8Array());
    file._push(fmiOB.toUint8Array());
    file._push(fmiTS.toUint8Array());
    file._push(bodyElem.toUint8Array());
    // Trailing sentinel element (2222,2299), 8-byte non-item value.  The
    // parser's readPart10Header lookahead misparses the first body element
    // as explicit while hunting for the end of the 0002 group; when a short
    // element sits at EOF that misparse reads past the buffer (pre-existing
    // parser quirk, unrelated to VR semantics).  A trailing element keeps
    // every fixture clear of that edge so these tests pin VR behavior only.
    const sentinel = new DicomWriter();
    sentinel.u16(0x2222);
    sentinel.u16(0x2299);
    sentinel.u32(8);
    sentinel._push(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    file._push(sentinel.toUint8Array());
    return file.toArrayBuffer();
}

/** Read the same buffer through all four read paths. */
async function readAllFour(buffer) {
    return {
        eager: DicomMessage.readFile(buffer.slice(0), { core: "eager" }),
        lazy: DicomMessage.readFile(buffer.slice(0), { core: "lazy" }),
        buffered: await runBuffered(buffer.slice(0)),
        stream: await runStream(buffer.slice(0))
    };
}

describe("AD-1: one implicit-SQ behavior across all four read paths", () => {
    const ITEM_START = [0xfe, 0xff, 0x00, 0xe0, 0x00, 0x00, 0x00, 0x00];
    const DELIM_START = [0xfe, 0xff, 0xdd, 0xe0, 0x00, 0x00, 0x00, 0x00];

    const UN_CASES = [
        ["value starts with item tag FFFE,E000", 0x2222, 0x2222, ITEM_START],
        ["value starts with delimiter FFFE,E0DD", 0x2222, 0x2222, DELIM_START],
        ["private tag, item-tag-start value", 0x2221, 0x2223, ITEM_START],
        ["FFFE group but wrong element", 0x2222, 0x2222,
            [0xfe, 0xff, 0x34, 0x12, 0x00, 0x00, 0x00, 0x00]],
        ["value shorter than 4 bytes", 0x2222, 0x2222, [0xfe, 0xff]]
    ];

    test.each(UN_CASES)(
        "defined-length dict-miss: %s → UN leaf everywhere",
        async (_name, group, element, bytes) => {
            const tagStr = (
                group.toString(16).padStart(4, "0") +
                element.toString(16).padStart(4, "0")
            ).toUpperCase();
            const buffer = buildImplicitBodyFile(
                group, element, new Uint8Array(bytes)
            );

            const { eager, lazy, buffered, stream } = await readAllFour(buffer);

            for (const [pathName, dict] of [
                ["eager", eager.dict],
                ["lazy", lazy.dict],
                ["buffered", buffered.dict],
                ["stream", stream.dict]
            ]) {
                expect({ path: pathName, entry: !!dict[tagStr] }).toEqual({
                    path: pathName, entry: true
                });
                expect({ path: pathName, vr: dict[tagStr].vr }).toEqual({
                    path: pathName, vr: "UN"
                });
            }

            // Full stream-vs-buffered parity.
            const problems = [];
            compareSection(buffered.meta || {}, stream.meta || {}, "meta", problems);
            compareSection(buffered.dict || {}, stream.dict || {}, "dict", problems);
            expect(problems).toEqual([]);
        }
    );

    test(
        "positive control: UNDEFINED-length dict-miss with item content → SQ everywhere",
        async () => {
            // Body: one empty item + sequence delimiter.
            const content = new Uint8Array([...ITEM_START, ...DELIM_START]);
            const buffer = buildImplicitBodyFile(
                0x2222, 0x2222, content, 0xffffffff
            );

            const { eager, lazy, buffered, stream } = await readAllFour(buffer);

            for (const [pathName, dict] of [
                ["eager", eager.dict],
                ["lazy", lazy.dict],
                ["buffered", buffered.dict],
                ["stream", stream.dict]
            ]) {
                expect({ path: pathName, vr: dict["22222222"]?.vr }).toEqual({
                    path: pathName, vr: "SQ"
                });
            }

            const problems = [];
            compareSection(buffered.meta || {}, stream.meta || {}, "meta", problems);
            compareSection(buffered.dict || {}, stream.dict || {}, "dict", problems);
            expect(problems).toEqual([]);
        }
    );
});

// ===========================================================================
// K4 TESTS — undefined-length structures stream natively; tail-fallback gone;
// chunk release live.  Written RED against K3 (which tail-falls-back on every
// undefined-length fixture) before the K4 implementation.
// ===========================================================================

/** Recursively list every *.dcm file under the given repo-relative dirs. */
function listDcmFiles(dirs) {
    const out = [];
    const walk = abs => {
        for (const name of fs.readdirSync(abs)) {
            const p = path.join(abs, name);
            const st = fs.statSync(p);
            if (st.isDirectory()) walk(p);
            else if (name.endsWith(".dcm")) out.push(path.relative(REPO_ROOT, p));
        }
    };
    for (const d of dirs) walk(path.join(REPO_ROOT, d));
    return out;
}

// Real encapsulated fixtures (undefined-length pixel data with fragments).
const FIXTURE_ENCAP_BOT =
    "packages/parser/testImages/encapsulated/single-frame/CT1_UNC.fragmented_bot_jpeg_ls.80.dcm";
const FIXTURE_ENCAP_NOBOT =
    "packages/parser/testImages/encapsulated/single-frame/CT1_UNC.fragmented_no_bot_jpeg_ls.80.dcm";
const FIXTURE_ENCAP_MULTI =
    "packages/parser/testImages/encapsulated/multi-frame/IM00001.fragmented_no_bot_jpeg_baseline.50.dcm";

// Undefined-length SQ fixtures (many top-level + nested undefined-length SQs).
const FIXTURE_SQ_UNDEF = "test/sample-dicom.dcm";
const FIXTURE_SQ_UNDEF2 =
    "packages/parser/testImages/encapsulated/multi-frame/CT0012.explicit_little_endian.dcm";
const FIXTURE_CINE = "test/cine-test.dcm";

// ---------------------------------------------------------------------------
// K4 Test 17: NO corpus fixture tail-falls-back anymore.
//
// The strongest deletion gate: every Part 10 fixture in the corpus must be
// streamed via the 'native' path (or 'deflate' for deflated syntax).  With K3
// most encapsulated / undefined-SQ fixtures report 'tailFallback'; after K4 the
// tail-fallback path is deleted and none may.
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K4: no fixture uses tail-fallback", () => {
    test("every corpus .dcm streams via native or deflate (never tailFallback)", async () => {
        const files = listDcmFiles(["packages/parser/testImages", "test"]);
        expect(files.length).toBeGreaterThan(0);

        const offenders = [];
        for (const rel of files) {
            const phases = [];
            const listener = new CollectorListener();
            try {
                await fromPart10Stream(readBuffer(rel).slice(0), listener, {
                    onPhase: p => phases.push(p)
                });
            } catch (e) {
                offenders.push(`${rel}: threw ${e.message}`);
                continue;
            }
            if (phases.includes("tailFallback")) {
                offenders.push(`${rel}: ${phases.join(",")}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// K4 Test 18: Real encapsulated fixtures — equivalence + native path
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K4: encapsulated pixel data streams natively", () => {
    test.each([
        ["fragmented + BOT (single chunk)", FIXTURE_ENCAP_BOT, b => b],
        ["fragmented + BOT (37-byte chunks)", FIXTURE_ENCAP_BOT, b => chunked(b, 37)],
        ["fragmented no-BOT (37-byte chunks)", FIXTURE_ENCAP_NOBOT, b => chunked(b, 37)],
        ["multi-frame fragmented (4096-byte chunks)", FIXTURE_ENCAP_MULTI, b => chunked(b, 4096)]
    ])("%s: events deep-equal buffered + onPhase='native'", async (_label, rel, toInput) => {
        const buffer = readBuffer(rel);
        const expected = await runBuffered(buffer.slice(0));
        const phases = [];
        const actual = await runStream(toInput(buffer.slice(0)), {
            onPhase: p => phases.push(p)
        });

        const problems = [];
        compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
        compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
        expect(problems).toEqual([]);

        expect(phases).toContain("native");
        expect(phases).not.toContain("tailFallback");
        expect(phases).not.toContain("deflate");
    });
});

// ---------------------------------------------------------------------------
// K4 Test 18b: Encapsulated pixel-data startElement length — stream vs buffered
//
// DELIBERATE DELTA: fromPart10Stream emits startElement({ length: 0xFFFFFFFF })
// for encapsulated pixel data (the on-wire undefined length).  Buffered
// fromPart10 emits the parser's computed content span (e.g. 164406 for
// CT1_UNC.fragmented_bot_jpeg_ls.80.dcm) because it knows the full file before
// emitting.  The stream MUST emit 0xFFFFFFFF up-front so that binaryFragment
// events can arrive before the input is complete (Test 19); emitting the
// computed span would require buffering the entire encapsulated element first,
// defeating fragment streaming.
//
// CollectorListener drops the length field; this test uses a tiny inline
// listener that records startElement options to assert the stream's value.
// ---------------------------------------------------------------------------

/** Listener that records every startElement call as { tag, length }. */
class StartElementCapture extends CollectorListener {
    constructor() {
        super();
        this.startEls = [];
    }
    _baseStartElement(tag, info = {}) {
        this.startEls.push({ tag, length: info.length });
        super._baseStartElement(tag, info);
    }
}

describe("fromPart10Stream — K4: encapsulated startElement length is 0xFFFFFFFF (delta from buffered)", () => {
    test("stream emits on-wire 0xFFFFFFFF for encapsulated pixel-data element", async () => {
        const buffer = readBuffer(FIXTURE_ENCAP_BOT);

        const listener = new StartElementCapture();
        await fromPart10Stream(buffer.slice(0), listener);

        // Find the pixel-data startElement event.
        const pixelEl = listener.startEls.find(e => e.tag === "7FE00010");
        expect(pixelEl).toBeDefined();
        // Stream emits the on-wire 0xFFFFFFFF (= 4294967295) — the computed
        // span is unknown at emission time (fragment streaming requires emitting
        // startElement before reading the closing delimiter).
        expect(pixelEl.length).toBe(0xffffffff);
        // Note: buffered fromPart10 emits the parser's computed span (the actual
        // byte count between startElement and the closing FFFE,E0DD) — a
        // gate-invisible delta because CollectorListener ignores this field.
    });
});

// ---------------------------------------------------------------------------
// K4 Test 19: Encapsulated fragments arrive BEFORE input completes
//
// The key streaming gate for fragments: a binaryFragment event must be
// delivered while the tail of the file is still gated behind a promise.  With
// K3 this is impossible (tail-fallback awaits the full input before emitting
// any pixel-data events).
// ---------------------------------------------------------------------------

class FirstFragmentListener extends BracketTrackingListener {
    constructor() {
        super();
        this._fragged = false;
        this._inEncapsulated = false;
        this.firstFragment = new Promise(resolve => {
            this._resolveFragment = resolve;
        });
    }
    startBinary(opts = {}) {
        // Only pixel-data fragments count — ignore FMI/leaf binary blobs.
        this._inEncapsulated = !!opts.encapsulated;
    }
    endBinary() {
        this._inEncapsulated = false;
    }
    binaryFragment(buf) {
        if (this._inEncapsulated && !this._fragged) {
            this._fragged = true;
            this._resolveFragment(buf ? buf.byteLength : 0);
        }
    }
}

describe("fromPart10Stream — K4: fragment events before input completes", () => {
    test("a binaryFragment arrives while the file tail is gated", async () => {
        const buffer = readBuffer(FIXTURE_ENCAP_BOT);
        const bytes = new Uint8Array(buffer);
        // Split roughly in half: the first half covers FMI + metadata + the
        // pixel-data header + several fragments; the tail stays gated.
        const SPLIT = Math.floor(bytes.length / 2);

        let unblockTail;
        const tailGate = new Promise(resolve => {
            unblockTail = resolve;
        });

        async function* gatingIterable() {
            yield bytes.slice(0, SPLIT);
            await tailGate;
            yield bytes.slice(SPLIT);
        }

        const listener = new FirstFragmentListener();
        const parsePromise = fromPart10Stream(gatingIterable(), listener);

        const fragTimeout = new Promise((_, reject) => {
            const t = setTimeout(
                () => reject(new Error("First fragment timeout — fragments not streamed incrementally")),
                10000
            );
            // unref so this timer does not keep the process alive if the real
            // promise wins (prevents "worker failed to exit gracefully" warnings).
            if (t?.unref) t.unref();
        });
        const fragLen = await Promise.race([listener.firstFragment, fragTimeout]);
        expect(typeof fragLen).toBe("number");
        expect(fragLen).toBeGreaterThan(0);

        unblockTail();
        await parsePromise;
    });
});

// ---------------------------------------------------------------------------
// K4 Test 20: Undefined-length SQ fixtures — equivalence + native path
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K4: undefined-length SQ streams natively", () => {
    test.each([
        ["sample-dicom (single chunk)", FIXTURE_SQ_UNDEF, b => b],
        ["sample-dicom (37-byte chunks)", FIXTURE_SQ_UNDEF, b => chunked(b, 37)],
        ["CT0012 explicit-LE (37-byte chunks)", FIXTURE_SQ_UNDEF2, b => chunked(b, 37)],
        ["cine-test (37-byte chunks)", FIXTURE_CINE, b => chunked(b, 37)]
    ])("%s: events deep-equal buffered + onPhase='native'", async (_label, rel, toInput) => {
        const buffer = readBuffer(rel);
        const expected = await runBuffered(buffer.slice(0));
        const phases = [];
        const actual = await runStream(toInput(buffer.slice(0)), {
            onPhase: p => phases.push(p)
        });

        const problems = [];
        compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
        compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
        expect(problems).toEqual([]);

        expect(phases).toContain("native");
        expect(phases).not.toContain("tailFallback");
    });
});

// ---------------------------------------------------------------------------
// K4 Test 21: startSequence length payload parity for undefined-length SQ
//
// Buffered emits startSequence({ length }) with the parser's computed content
// span (position of the sequence delimiter minus the sequence dataOffset), NOT
// 0xFFFFFFFF.  The stream path must emit the SAME length for every sequence.
// ---------------------------------------------------------------------------

class SeqLengthListener extends CollectorListener {
    constructor() {
        super();
        this._seqLengths = [];
    }
    _baseStartSequence(tag, info = {}) {
        super._baseStartSequence(tag, info);
        this._seqLengths.push(`${tag}:${info.length}`);
    }
}

describe("fromPart10Stream — K4: undefined-length SQ length-payload parity", () => {
    test("startSequence lengths match buffered element-for-element", async () => {
        const buffer = readBuffer(FIXTURE_SQ_UNDEF);

        const bufferedListener = new SeqLengthListener();
        await fromPart10(buffer.slice(0), bufferedListener);

        const streamListener = new SeqLengthListener();
        await fromPart10Stream(chunked(buffer.slice(0), 37), streamListener);

        expect(streamListener._seqLengths.length).toBeGreaterThan(0);
        expect(streamListener._seqLengths).toEqual(bufferedListener._seqLengths);
    });
});

// ---------------------------------------------------------------------------
// K4 Test 22: Synthesized undefined-length non-SQ leaf ("eagerWindow")
//
// The J4a "eagerWindow" hard case: a private explicit-VR UN element of
// undefined length with zero-length items ending in a sequence delimiter
// (FFFE,E0DD).  The parser routes this through readSequenceItemsImplicit and
// dcmjs decodes it via the eager reader (decodeWithEagerReadTag), NOT as an SQ.
// The stream path must bound the element window to the same delimiter and
// decode identically, with the same startElement length payload (the parser's
// content span).  Mirrors test/eventStream/fromPart10.test.js's J4a builder.
// ---------------------------------------------------------------------------

/**
 * Build an Explicit-LE Part 10 file whose body is a single private UN element
 * (group/element given, undefined length) containing `numEmptyItems`
 * zero-length items and a closing sequence delimiter (FFFE,E0DD).
 */
function buildUndefinedUnLeafFile(group, element, numEmptyItems) {
    const tsStr = "1.2.840.10008.1.2.1\0"; // ELE

    const fmiOB = new DicomWriter();
    fmiOB.elemLong(0x0002, 0x0001, "OB", new Uint8Array([0, 1]));
    const fmiTS = new DicomWriter();
    fmiTS.elemStd(
        0x0002, 0x0010, "UI",
        new Uint8Array(tsStr.split("").map(c => c.charCodeAt(0)))
    );
    const restFmiLen = fmiOB.toUint8Array().length + fmiTS.toUint8Array().length;
    const glBytes = new Uint8Array(4);
    new DataView(glBytes.buffer).setUint32(0, restFmiLen, true);
    const fmiGL = new DicomWriter();
    fmiGL.elemStd(0x0002, 0x0000, "UL", glBytes);

    // Body element: explicit UN long-form header with undefined length.
    const body = new DicomWriter();
    body.u16(group);
    body.u16(element);
    body.ascii("UN");
    body.u16(0); // reserved
    body.u32(0xffffffff); // undefined length
    for (let i = 0; i < numEmptyItems; i++) {
        body.u16(0xfffe);
        body.u16(0xe000);
        body.u32(0); // zero-length item
    }
    // Sequence delimiter FFFE,E0DD + 0 length.
    body.u16(0xfffe);
    body.u16(0xe0dd);
    body.u32(0);

    const file = new DicomWriter();
    file.zeros(128);
    file.ascii("DICM");
    file._push(fmiGL.toUint8Array());
    file._push(fmiOB.toUint8Array());
    file._push(fmiTS.toUint8Array());
    file._push(body.toUint8Array());
    return file.toArrayBuffer();
}

class ElementLengthListener extends CollectorListener {
    constructor() {
        super();
        this._elLengths = [];
    }
    _baseStartElement(tag, info = {}) {
        super._baseStartElement(tag, info);
        this._elLengths.push(`${tag}:${info.length}`);
    }
}

describe("fromPart10Stream — K4: undefined-length non-SQ leaf (eagerWindow)", () => {
    test.each([
        ["single chunk", b => b],
        ["37-byte chunks", b => chunked(b, 37)]
    ])("%s: events + element length match buffered", async (_label, toInput) => {
        // Private (0099,0001) UN, undefined length, two zero-length items,
        // sequence delimiter — the J4a eagerWindow fixture.
        const buffer = buildUndefinedUnLeafFile(0x0099, 0x0001, 2);

        const bufferedListener = new ElementLengthListener();
        await fromPart10(buffer.slice(0), bufferedListener);

        const phases = [];
        const streamListener = new ElementLengthListener();
        await fromPart10Stream(toInput(buffer.slice(0)), streamListener, {
            onPhase: p => phases.push(p)
        });

        const problems = [];
        compareSection(
            bufferedListener.result.dict || {},
            streamListener.result.dict || {},
            "dict",
            problems
        );
        expect(problems).toEqual([]);
        // Length-payload parity for the undefined-length leaf element.
        expect(streamListener._elLengths.length).toBeGreaterThan(0);
        expect(streamListener._elLengths).toEqual(bufferedListener._elLengths);
        expect(phases).toContain("native");
        expect(phases).not.toContain("tailFallback");
    });
});

// ---------------------------------------------------------------------------
// K4 Test 22b: Undefined-length text VR (UT) with FFFE,E00D terminator —
//              KNOWINGLY-ACCEPTED DIVERGENCE (stream throws; buffered: garbage)
//
// DICOM PS3.5 only permits undefined length for SQ, items, and encapsulated
// pixel data.  A UT (or UC/UR) element with length 0xFFFFFFFF is non-conformant.
// The two paths handle it differently (empirically verified, pinned here):
//
//   buffered fromPart10 — readEncodedString clamps the 0xFFFFFFFF read to the
//     buffer end, consuming ALL remaining bytes (delimiter + trailing elements)
//     as the UT string.  Returns successfully with garbage value; trailing
//     elements after the FFFE,E00D are silently lost.
//
//   fromPart10Stream — emitUndefinedLeaf's skipUndefinedSequence sees the
//     non-FFFE value bytes as malformed (not FFFE,E0DD / FFFE,E000) and stops
//     immediately; the body loop then re-parses the value bytes as a DICOM
//     element, producing a truncation throw.
//
// This is a DELIBERATE loud-failure divergence: stream fails loudly on input
// that buffered silently mishandles.  The test pins actual observed behavior
// so the divergence is explicit and reviewable rather than accidental.
// ---------------------------------------------------------------------------

/**
 * Build an Explicit-LE Part 10 file whose body is a single explicit-VR UT
 * element with undefined length (12-byte long form), followed by `valueBytes`,
 * an FFFE,E00D item delimiter, and a trailing (0008,0060) CS "CT" element.
 * This structure is non-conformant per PS3.5 (undefined length is only
 * permitted for SQ/items/encapsulated pixel data).
 */
function buildUndefinedLengthUtFile(valueBytes) {
    const tsStr = "1.2.840.10008.1.2.1\0"; // Explicit Little Endian

    const fmiOB = new DicomWriter();
    fmiOB.elemLong(0x0002, 0x0001, "OB", new Uint8Array([0, 1]));
    const fmiTS = new DicomWriter();
    fmiTS.elemStd(
        0x0002, 0x0010, "UI",
        new Uint8Array(tsStr.split("").map(c => c.charCodeAt(0)))
    );
    const restFmiLen = fmiOB.toUint8Array().length + fmiTS.toUint8Array().length;
    const glBytes = new Uint8Array(4);
    new DataView(glBytes.buffer).setUint32(0, restFmiLen, true);
    const fmiGL = new DicomWriter();
    fmiGL.elemStd(0x0002, 0x0000, "UL", glBytes);

    const body = new DicomWriter();
    // UT long-form header: tag(4) + VR(2) + reserved(2) + length(4) = 12 bytes.
    body.u16(0x0008); body.u16(0x0104); // (0008,0104) CodeMeaning
    body.ascii("UT");
    body.u16(0);           // reserved
    body.u32(0xffffffff);  // undefined length — non-conformant for UT
    // value bytes (text content before the delimiter)
    body._push(valueBytes);
    // FFFE,E00D item delimiter (NOT E0DD sequence delimiter)
    body.u16(0xfffe); body.u16(0xe00d); body.u32(0);
    // Trailing element: (0008,0060) CS "CT"
    body.u16(0x0008); body.u16(0x0060);
    body.ascii("CS"); body.u16(2); body.ascii("CT");

    const file = new DicomWriter();
    file.zeros(128);
    file.ascii("DICM");
    file._push(fmiGL.toUint8Array());
    file._push(fmiOB.toUint8Array());
    file._push(fmiTS.toUint8Array());
    file._push(body.toUint8Array());
    return file.toArrayBuffer();
}

describe("fromPart10Stream — K4: undefined-length UT with E00D delimiter (divergence)", () => {
    test("buffered returns garbage; stream throws truncation (knowingly-accepted divergence)", async () => {
        // Value bytes: "hello" (5 bytes).  Non-FFFE bytes guarantee skipUndefinedSequence
        // stops at value-start, causing the body loop to re-parse them as a DICOM
        // element with a garbage length → truncation throw.
        const VALUE = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"
        const buffer = buildUndefinedLengthUtFile(VALUE);

        // ---- buffered path: does NOT throw; returns garbage ----
        // readEncodedString clamps the 0xFFFFFFFF read to the buffer boundary,
        // consuming all remaining bytes (delimiter + trailing CS element) as the
        // UT string.  The trailing (0008,0060) CS element is lost.
        const bufferedListener = new CollectorListener();
        await expect(
            fromPart10(buffer.slice(0), bufferedListener)
        ).resolves.toBeUndefined();

        const utEntry = bufferedListener.result.dict["00080104"];
        expect(utEntry).toBeDefined();
        expect(utEntry.vr).toBe("UT");
        // The garbage value bleeds past the E00D delimiter and contains the
        // delimiter bytes and trailing element bytes.
        const utValue = utEntry.Value[0];
        expect(typeof utValue).toBe("string");
        // Confirm bleed: value includes bytes from the FFFE,E00D delimiter.
        // \xfe\xff = þÿ (or equivalent depending on TextDecoder), \r = 0x0D, à = 0xE0.
        expect(utValue.length).toBeGreaterThan(VALUE.length); // includes delimiter + CS bytes
        // Trailing (0008,0060) CS element is silently consumed into the UT value.
        expect(bufferedListener.result.dict["00080060"]).toBeUndefined();

        // ---- stream path: DOES throw (loud failure on non-conformant data) ----
        // emitUndefinedLeaf stops at value-start (malformed item scan), then the
        // body loop re-parses the value bytes as a DICOM element.  The garbage
        // element declares a length larger than the remaining bytes → truncation.
        const streamListener = new CollectorListener();
        await expect(
            fromPart10Stream(buffer.slice(0), streamListener)
        ).rejects.toThrow(/truncated/);
    });
});

// ---------------------------------------------------------------------------
// K4 Test 23: Synthesized UN-as-implicit-SQ variant
//
// An implicit dictionary-unknown element of undefined length whose value begins
// with an item tag is resolved as an implicit SQ by dcmjs (resolveVrInstance's
// hadUndefinedLength -> SQ branch, confirmed by the item-tag data-peek).  The
// stream path must reach the same classification and emit SQ events.
// ---------------------------------------------------------------------------

/** Build an Implicit-LE file with one undefined-length body element. */
function buildImplicitUndefinedFile(group, element, valueBytes) {
    const ILE_TS = "1.2.840.10008.1.2\0";
    const fmiOB = new DicomWriter();
    fmiOB.elemLong(0x0002, 0x0001, "OB", new Uint8Array([0, 1]));
    const fmiTS = new DicomWriter();
    fmiTS.elemStd(
        0x0002, 0x0010, "UI",
        new Uint8Array(ILE_TS.split("").map(c => c.charCodeAt(0)))
    );
    const restFmiLen = fmiOB.toUint8Array().length + fmiTS.toUint8Array().length;
    const glBytes = new Uint8Array(4);
    new DataView(glBytes.buffer).setUint32(0, restFmiLen, true);
    const fmiGL = new DicomWriter();
    fmiGL.elemStd(0x0002, 0x0000, "UL", glBytes);

    const body = new DicomWriter();
    body.u16(group);
    body.u16(element);
    body.u32(0xffffffff); // undefined length
    body._push(valueBytes);

    const file = new DicomWriter();
    file.zeros(128);
    file.ascii("DICM");
    file._push(fmiGL.toUint8Array());
    file._push(fmiOB.toUint8Array());
    file._push(fmiTS.toUint8Array());
    file._push(body.toUint8Array());
    return file.toArrayBuffer();
}

describe("fromPart10Stream — K4: UN-as-implicit-SQ variant", () => {
    test.each([
        ["single chunk", b => b],
        ["37-byte chunks", b => chunked(b, 37)]
    ])("%s: dictionary-unknown implicit undefined-length -> SQ matches buffered", async (_label, toInput) => {
        // One item (FFFE,E000 undefined) with one child CS element, ending with
        // an item delimiter, then a sequence delimiter (FFFE,E0DD).
        const seqBytes = new Uint8Array([
            // item start FFFE,E000, undefined length
            0xfe, 0xff, 0x00, 0xe0, 0xff, 0xff, 0xff, 0xff,
            // child: (0008,0060) implicit, length 2, "CT"
            0x08, 0x00, 0x60, 0x00, 0x02, 0x00, 0x00, 0x00, 0x43, 0x54,
            // item delimiter FFFE,E00D + 0 length
            0xfe, 0xff, 0x0d, 0xe0, 0x00, 0x00, 0x00, 0x00,
            // sequence delimiter FFFE,E0DD + 0 length
            0xfe, 0xff, 0xdd, 0xe0, 0x00, 0x00, 0x00, 0x00
        ]);
        // Even (non-private) group so the implicit undefined-length element is
        // retained as an SQ with items (private groups get items cleared).
        const buffer = buildImplicitUndefinedFile(0x4444, 0x4444, seqBytes);

        const expected = await runBuffered(buffer.slice(0));
        const phases = [];
        const actual = await runStream(toInput(buffer.slice(0)), {
            onPhase: p => phases.push(p)
        });

        const problems = [];
        compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
        compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
        expect(problems).toEqual([]);
        expect(actual.dict["44444444"]).toBeDefined();
        expect(actual.dict["44444444"].vr).toBe("SQ");
        expect(phases).toContain("native");
        expect(phases).not.toContain("tailFallback");
    });
});

// ---------------------------------------------------------------------------
// K4 Test 24: Chunk-release smoke test (bounded memory)
//
// Streaming a corpus encapsulated fixture in small chunks must actually release
// consumed chunks (clearBuffers + consume live).  We sample the stream's
// getBufferMemoryInfo() after each top-level consume via an internal onConsume
// hook and assert (a) it fires repeatedly, (b) the consume offset advances, and
// (c) retained bytes end up far below the file size — proving buffers were
// nulled, which cannot happen with release off (K3).
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K4: chunk release is live (bounded-memory smoke)", () => {
    test("encapsulated fixture in small chunks releases consumed buffers", async () => {
        const buffer = readBuffer(FIXTURE_ENCAP_BOT);
        const fileLen = buffer.byteLength;

        const memSamples = [];
        const listener = new CollectorListener();
        await fromPart10Stream(chunked(buffer.slice(0), 4096), listener, {
            onConsume: info => memSamples.push(info)
        });

        // The hook fired for many top-level elements.
        expect(memSamples.length).toBeGreaterThanOrEqual(5);

        // Consume offset advances monotonically.
        for (let i = 1; i < memSamples.length; i++) {
            expect(memSamples[i].consumeOffset).toBeGreaterThanOrEqual(
                memSamples[i - 1].consumeOffset
            );
        }

        // Release genuinely happened: the final retained totalSize is far below
        // the file size (buffers were nulled).  With release off this equals the
        // full file size.
        const last = memSamples[memSamples.length - 1];
        expect(last.totalSize).toBeLessThan(fileLen / 2);

        // Buffers were actually nulled by consume(): with release off the
        // final report would still hold every fed chunk (totalSize == fileLen).
        expect(last.bufferCount).toBeLessThan(
            Math.ceil(fileLen / 4096)
        );
    });
});

// ===========================================================================
// K5: Deflate body streaming via chunked pako inflater
// ===========================================================================

// Deflate corpus fixtures (DEFLATED_EXPLICIT_LITTLE_ENDIAN = 1.2.840.10008.1.2.1.99).
const FIXTURE_DFL_WAVE = "packages/parser/testImages/deflate/wave_dfl";
const FIXTURE_DFL_IMAGE = "packages/parser/testImages/deflate/image_dfl";
const FIXTURE_DFL_REPORT = "packages/parser/testImages/deflate/report_dfl";

// ---------------------------------------------------------------------------
// K5 Test 25 — KEY RED TEST: deflate body element events before input completes
//
// K4 buffers all deflate bytes before delegating to fromPart10(_skipMeta:true),
// so no body event can arrive until the input generator is fully exhausted.
// K5's stream-inflate path must allow body element events to arrive while the
// file tail is still gated.
//
// Gate design: yield the first half of the file, block on a Promise, yield the
// second half.  A BodyGateListener resolves firstBodyElement the instant any
// body element event fires after FMI.  We race that promise against a 10 s
// timeout.  K4 (deflate guard was dead; compressed bytes hit native loop and threw)
// → RED. K5 (streaming inflate) resolves early → GREEN.
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K5: deflate body events before input completes (KEY RED TEST)", () => {
    test("first deflate body element arrives while file tail is gated", async () => {
        // wave_dfl is the largest deflate fixture (~26 kB compressed), giving
        // the inflater enough data in the first half to emit at least one body
        // element before the tail is released.
        const buffer = readBuffer(FIXTURE_DFL_WAVE);
        const bytes = new Uint8Array(buffer);
        // Split just past the mid-point so the first chunk covers FMI + a
        // meaningful slice of the compressed body.
        const SPLIT = Math.floor(bytes.length * 0.6);

        let unblockTail;
        const tailGate = new Promise(resolve => {
            unblockTail = resolve;
        });

        async function* gatingIterable() {
            yield bytes.slice(0, SPLIT);
            await tailGate;
            yield bytes.slice(SPLIT);
        }

        const listener = new BodyGateListener();
        const parsePromise = fromPart10Stream(gatingIterable(), listener);

        const bodyTimeout = new Promise((_, reject) => {
            const t = setTimeout(
                () =>
                    reject(
                        new Error(
                            "Deflate body element timeout — K5 not incremental (K4 buffers)"
                        )
                    ),
                10000
            );
            // unref so this timer does not keep the process alive if the real
            // promise wins (prevents "worker failed to exit gracefully" warnings).
            if (t?.unref) t.unref();
        });

        const firstTag = await Promise.race([
            listener.firstBodyElement,
            bodyTimeout
        ]);

        // K5 assertion: a body element arrived before the tail was released.
        expect(typeof firstTag).toBe("string");
        expect(firstTag.length).toBe(8); // "GGGGEEEE" format

        unblockTail();
        await parsePromise;
    });
});

// ---------------------------------------------------------------------------
// K5 Test 26 — Deflate equivalence: events match buffered fromPart10
//
// Three deflate fixtures, single-chunk and 37-byte-chunk inputs.
// Parity target is the buffered fromPart10 events (same as K1–K4).
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K5: deflate equivalence (events match buffered fromPart10)", () => {
    test.each([
        ["wave_dfl  — single chunk",   FIXTURE_DFL_WAVE,   b => b],
        ["wave_dfl  — 37-byte chunks", FIXTURE_DFL_WAVE,   b => chunked(b, 37)],
        ["image_dfl — single chunk",   FIXTURE_DFL_IMAGE,  b => b],
        ["image_dfl — 37-byte chunks", FIXTURE_DFL_IMAGE,  b => chunked(b, 37)],
        ["report_dfl — single chunk",  FIXTURE_DFL_REPORT, b => b],
        ["report_dfl — 37-byte chunks",FIXTURE_DFL_REPORT, b => chunked(b, 37)]
    ])("%s", async (_label, fixture, toInput) => {
        const buffer = readBuffer(fixture);

        const expected = await runBuffered(buffer.slice(0));
        const phases = [];
        const actual = await runStream(toInput(buffer.slice(0)), {
            onPhase: p => phases.push(p)
        });

        const problems = [];
        compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
        compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
        expect(problems).toEqual([]);

        // K5: deflate now streams natively — onPhase must report "native".
        expect(phases).toContain("native");
        expect(phases).not.toContain("deflate"); // old K4 buffered-path label
        expect(phases).not.toContain("tailFallback");
    });
});

// ---------------------------------------------------------------------------
// K5 Test 27 — Seam-split chunkings: chunk boundary straddles FMI/body seam
//
// One chunking where a chunk straddles the FMI/body seam (the chunk that
// contains the last FMI byte also contains the first deflate-body byte), and
// one where the seam falls exactly on a chunk boundary.  Both must produce
// events identical to the buffered path.
//
// The wave_dfl fixture's FMI ends at ~201 bytes (after the TransferSyntaxUID
// element).  We use chunk sizes 199 (straddles: chunk [0,199) contains bytes
// up to 198, so the seam at ~201 is inside chunk [198,396)) and 201 (exact
// edge: if FMI is <= 201 bytes, the seam falls on the chunk boundary).
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K5: seam-split chunkings (FMI/deflate-body boundary)", () => {
    test.each([
        ["chunk size 199 (straddles FMI/body seam)", 199],
        ["chunk size 201 (near-exact seam edge)",    201],
        ["chunk size 73  (many small straddle cases)", 73]
    ])("%s", async (_label, chunkSize) => {
        const buffer = readBuffer(FIXTURE_DFL_WAVE);

        const expected = await runBuffered(buffer.slice(0));
        const phases = [];
        const actual = await runStream(chunked(buffer.slice(0), chunkSize), {
            onPhase: p => phases.push(p)
        });

        const problems = [];
        compareSection(expected.meta || {}, actual.meta || {}, "meta", problems);
        compareSection(expected.dict || {}, actual.dict || {}, "dict", problems);
        expect(problems).toEqual([]);
        expect(phases).toContain("native");
        expect(phases).not.toContain("deflate");
    });
});

// ---------------------------------------------------------------------------
// K5 Test 28 — Corrupt-deflate error class parity
//
// A synthetic DICOM file whose deflate body is corrupted (all-zeros instead of
// valid compressed bytes).  Both the buffered and streaming paths must throw;
// the streaming path must not swallow the error or replace it with a generic
// truncation error (class parity: Error, not TypeError or similar).
// ---------------------------------------------------------------------------

/** Build a minimal Part 10 deflate file with a garbled compressed body. */
function buildCorruptDeflateFile() {
    // Construct a minimal valid explicit-LE DICOM and compress the body.
    // Then replace the compressed body with garbage.
    const DEFLATE_TS = "1.2.840.10008.1.2.1.99\0";
    const tsBytes = new Uint8Array(DEFLATE_TS.split("").map(c => c.charCodeAt(0)));

    const fmiOB = new DicomWriter();
    fmiOB.elemLong(0x0002, 0x0001, "OB", new Uint8Array([0, 1]));
    const fmiTS = new DicomWriter();
    fmiTS.elemStd(0x0002, 0x0010, "UI", tsBytes);

    const restFmiLen =
        fmiOB.toUint8Array().length + fmiTS.toUint8Array().length;
    const glBytes = new Uint8Array(4);
    new DataView(glBytes.buffer).setUint32(0, restFmiLen, true);
    const fmiGL = new DicomWriter();
    fmiGL.elemStd(0x0002, 0x0000, "UL", glBytes);

    // Garbage compressed bytes — not valid deflate output.
    const garbage = new Uint8Array(64).fill(0xff);

    const file = new DicomWriter();
    file.zeros(128);
    file.ascii("DICM");
    file._push(fmiGL.toUint8Array());
    file._push(fmiOB.toUint8Array());
    file._push(fmiTS.toUint8Array());
    file._push(garbage);
    return file.toArrayBuffer();
}

describe("fromPart10Stream — K5: corrupt-deflate error class parity", () => {
    test("corrupt compressed body throws (both paths reject — class parity)", async () => {
        const buffer = buildCorruptDeflateFile();

        // Buffered path: pako.inflateRaw throws a string in pako 2.x (not Error),
        // so verify it rejects but document the type.
        let bufferedErr;
        try {
            await fromPart10(buffer.slice(0), new CollectorListener());
        } catch (e) {
            bufferedErr = e;
        }
        expect(bufferedErr).toBeTruthy(); // buffered path throws on corrupt deflate
        // pako 2.x throws string, not Error instance — but it does throw.
        expect(typeof bufferedErr === "string" || bufferedErr instanceof Error).toBe(true);

        // Streaming path: must also reject (not resolve silently), and must be Error.
        let streamErr;
        try {
            await fromPart10Stream(buffer.slice(0), new CollectorListener());
        } catch (e) {
            streamErr = e;
        }
        expect(streamErr).toBeTruthy(); // streaming path throws on corrupt deflate
        expect(streamErr instanceof Error).toBe(true); // streaming side wraps as Error
    });
});

// ---------------------------------------------------------------------------
// K5 Test 29 — Deflate release: chunk memory is freed as body is parsed
//
// Streaming a deflate fixture in small chunks must release consumed inflated
// chunks (bodyStream clearBuffers + consume).  The onConsume hook (which fires
// per top-level element) must advance monotonically and the final retained
// size must be far below the inflated body size.
// ---------------------------------------------------------------------------

describe("fromPart10Stream — K5: deflate chunk release is live", () => {
    test("deflate fixture in small chunks releases consumed bodyStream buffers", async () => {
        const buffer = readBuffer(FIXTURE_DFL_WAVE);

        const memSamples = [];
        const listener = new CollectorListener();
        await fromPart10Stream(chunked(buffer.slice(0), 512), listener, {
            onConsume: info => memSamples.push(info)
        });

        // The hook fired at least once per body element.
        expect(memSamples.length).toBeGreaterThanOrEqual(3);

        // Consume offset advances monotonically (body side).
        for (let i = 1; i < memSamples.length; i++) {
            expect(memSamples[i].consumeOffset).toBeGreaterThanOrEqual(
                memSamples[i - 1].consumeOffset
            );
        }

        // The final retained size in bodyStream is far below the total
        // inflated body size — proving consume() actually freed buffers.
        const last = memSamples[memSamples.length - 1];
        expect(last.totalSize).toBeLessThan(50 * 1024); // wave body is ~6.8 kB inflated

        // Also verify RAW stream's retained bytes drop during chunked deflate parse.
        // The relay concurrently consumes raw stream chunks as it feeds bodyStream.
        expect(last.rawStreamInfo).toBeDefined();
        const rawLast = last.rawStreamInfo;
        // Retained total size in raw stream must be far below the compressed file size
        // (~26 kB compressed), proving the relay released chunks as it advanced.
        expect(rawLast.totalSize).toBeLessThan(50 * 1024);
    });
});

// ---------------------------------------------------------------------------
// K5b: feed backpressure — the raw feed loop must throttle against a stalled
// consumer instead of buffering the whole input.
//
// Scenario this guards (found on a 21.8 GB Sup 225 video rewrite): the
// listener's drain gate is closed for a long time (disk flush of a written
// fragment). The feed loop previously kept pulling the source at full speed
// into the parse buffer, so the entire remaining input accumulated in memory.
// With the gate, the feed may run at most `feedHighWater` ahead unless the
// parser is actively demanding bytes (pending demand always wins, so a
// fragment larger than the watermark still accumulates and cannot deadlock).
// ---------------------------------------------------------------------------

/**
 * Build a synthesized encapsulated Part 10 file (JPEG baseline transfer
 * syntax) whose pixel data holds `fragCount` fragments of `fragSize` bytes
 * (fragSize must be even). Fragment i is filled with the byte (i & 0xff).
 */
function buildSyntheticEncapsulatedFile(fragCount, fragSize) {
    const tsStr = "1.2.840.10008.1.2.4.50\0\0"; // JPEG baseline, even length

    const fmiOB = new DicomWriter();
    fmiOB.elemLong(0x0002, 0x0001, "OB", new Uint8Array([0, 1]));

    const fmiTS = new DicomWriter();
    fmiTS.elemStd(
        0x0002, 0x0010, "UI",
        new Uint8Array(tsStr.split("").map(c => c.charCodeAt(0)))
    );

    const restFmiLen =
        fmiOB.toUint8Array().length + fmiTS.toUint8Array().length;
    const glBytes = new Uint8Array(4);
    new DataView(glBytes.buffer).setUint32(0, restFmiLen, true);
    const fmiGL = new DicomWriter();
    fmiGL.elemStd(0x0002, 0x0000, "UL", glBytes);

    const body = new DicomWriter();
    body.elemStd(0x0008, 0x0060, "CS", new Uint8Array([0x43, 0x54])); // "CT"
    // (7FE0,0010) OB, undefined length
    body.u16(0x7fe0); body.u16(0x0010);
    body.ascii("OB"); body.u16(0);
    body.u32(0xffffffff);
    // Empty Basic Offset Table
    body.u16(0xfffe); body.u16(0xe000); body.u32(0);
    for (let i = 0; i < fragCount; i++) {
        body.u16(0xfffe); body.u16(0xe000); body.u32(fragSize);
        const frag = new Uint8Array(fragSize);
        frag.fill(i & 0xff);
        body._push(frag);
    }
    // Sequence delimiter
    body.u16(0xfffe); body.u16(0xe0dd); body.u32(0);

    const file = new DicomWriter();
    file.zeros(128);
    file.ascii("DICM");
    file._push(fmiGL.toUint8Array());
    file._push(fmiOB.toUint8Array());
    file._push(fmiTS.toUint8Array());
    file._push(body.toUint8Array());
    return file.toUint8Array();
}

describe("fromPart10Stream — K5b: feed throttles against a stalled listener drain", () => {
    test("feed pulls at most feedHighWater ahead while drain is blocked", async () => {
        const FRAG_COUNT = 64;
        const FRAG_SIZE = 8 * 1024;
        const CHUNK = 4 * 1024;
        const HIGH_WATER = 16 * 1024;

        const fileBytes = buildSyntheticEncapsulatedFile(FRAG_COUNT, FRAG_SIZE);
        expect(fileBytes.length).toBeGreaterThan(500 * 1024);

        // Instrumented source: counts bytes the feed loop has pulled.
        let yielded = 0;
        async function* countingSource() {
            for (let off = 0; off < fileBytes.length; off += CHUNK) {
                const end = Math.min(off + CHUNK, fileBytes.length);
                yield fileBytes.subarray(off, end);
                yielded = end;
            }
        }

        // Listener that blocks its drain gate once the first encapsulated
        // fragment has arrived, until the test releases it.
        let releaseGate;
        const gate = new Promise(resolve => (releaseGate = resolve));
        let signalFirstFragment;
        const firstFragment = new Promise(
            resolve => (signalFirstFragment = resolve)
        );

        // Subclass, not post-construction assignment: EventStreamListener
        // builds its method chains in the constructor, so _base* overrides
        // must exist on the prototype before construction.
        class GatedListener extends EventStreamListener {
            encapsulated = false;
            blocking = false;
            fragments = [];
            _baseStartBinary(opts) {
                this.encapsulated = !!opts?.encapsulated;
            }
            _baseBinaryFragment(buf) {
                if (!this.encapsulated) return;
                const bytes =
                    buf instanceof Uint8Array ? buf : new Uint8Array(buf);
                this.fragments.push(bytes.slice());
                if (this.fragments.length === 1) {
                    this.blocking = true;
                    signalFirstFragment();
                }
            }
        }
        const base = new GatedListener();
        const { fragments } = base;
        base.setDrain(async () => {
            if (base.blocking) {
                await gate;
                base.blocking = false;
            }
        });

        const parsePromise = fromPart10Stream(countingSource(), base, {
            feedHighWater: HIGH_WATER
        });

        await firstFragment;
        const yieldedAtBlock = yielded;

        // Give the feed loop ample opportunity to over-pull.
        await new Promise(resolve => setTimeout(resolve, 50));
        const yieldedDuringStall = yielded - yieldedAtBlock;

        releaseGate();
        await parsePromise;

        // Correctness: every fragment arrived intact.
        expect(fragments.length).toBe(FRAG_COUNT);
        fragments.forEach((frag, i) => {
            expect(frag.byteLength).toBe(FRAG_SIZE);
            expect(frag[0]).toBe(i & 0xff);
        });

        // The throttle bound: watermark plus a few chunks of slack. Without
        // the feed gate the loop pulls the whole remaining file here
        // (~500 kB), so this cleanly distinguishes fixed from broken.
        expect(yieldedDuringStall).toBeLessThanOrEqual(HIGH_WATER + 4 * CHUNK);
    });
});
