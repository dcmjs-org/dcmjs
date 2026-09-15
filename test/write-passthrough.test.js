import fs from "fs";
import path from "path";
import { parseDicom } from "@dcmjs/parser";
import dcmjs from "../src/index.js";
import { WriteBufferStream } from "../src/BufferStream";
import { collectSectionProblems } from "./helper/equivalence.js";

const { DicomMessage, Tag } = dcmjs.data;

/**
 * W3 (docs roadmap R4 item 1) - the passthrough fast path.
 *
 * A dict read by the lazy core carries `_lazyWriteContext`; when the write
 * syntax equals the source transfer syntax and the source charset is
 * byte-stable under the writer's UTF-8 normalization
 * (charsetPassthroughSafe), every clean entry (isCleanForPassthrough) is
 * emitted as its verbatim source span instead of being re-encoded. This
 * suite asserts the resulting guarantee: read -> write with zero edits
 * reproduces the input file's BODY byte-for-byte, and an edit changes only
 * the edited element's bytes.
 *
 * PRINCIPLED DIVERGENCES (documented per the task):
 *  - The meta group (group 0002) is always re-encoded (group length
 *    recompute), so only the BODY region is compared.
 *  - A top-level SpecificCharacterSet (0008,0005) element is rewritten to
 *    ["ISO_IR 192"] on read (the normalize-on-read quirk, kept per R5) and
 *    carries no _sourceSpan, so the writer re-encodes it. The expected
 *    body therefore splices the re-encoded element over the source span
 *    (for sources already storing "ISO_IR 192" the splice is a no-op).
 *  - Fixtures whose charset is NOT passthrough safe (the ISO_IR 100
 *    majority of this corpus) re-encode everything by design: their
 *    latin-1 string bytes are not UTF-8 stable, so the dict-level gate
 *    disables passthrough. To still exercise the structural byte-identity
 *    (undefined-length SQs, encapsulated/fragmented pixel data, RLE, big
 *    endian) those fixtures are ALSO tested through a charset-neutralized
 *    variant: a copy whose 10-byte 0008,0005 value "ISO_IR 100"/
 *    "ISO-IR 100" is byte-patched to the same-length "ISO_IR 192", making
 *    the file passthrough safe while leaving every other byte untouched.
 *  - Deflated sources are excluded from the whole-file byte-identity
 *    tiers here: since W4 the body passes through into the pre-deflate
 *    stream and is re-deflated, but the deflate wrapper bytes depend on
 *    the encoder, so the OUTPUT FILE is not byte-identical to the source.
 *    Pre-deflate body byte-identity is asserted in write-deflate.test.js.
 */

const REPO_ROOT = path.join(__dirname, "..");
const PARSER_IMAGES_DIR = path.join(
    REPO_ROOT,
    "packages",
    "parser",
    "testImages"
);
const DEFLATED_TRANSFER_SYNTAX = "1.2.840.10008.1.2.1.99";
const UTF8_CHARSET = "ISO_IR 192";

/** Recursively collects files under dir for which accept(fileName) holds. */
function discoverFixtures(dir, accept) {
    const found = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            found.push(...discoverFixtures(fullPath, accept));
        } else if (stat.isFile() && accept(name)) {
            found.push(fullPath);
        }
    }
    return found;
}

const ALL_FIXTURES = [
    ...discoverFixtures(
        PARSER_IMAGES_DIR,
        name => !name.toLowerCase().endsWith(".md")
    ),
    ...discoverFixtures(__dirname, name => /\.(dcm|dicom)$/i.test(name))
].map(fullPath => [path.relative(REPO_ROOT, fullPath), fullPath]);

/** Exact ArrayBuffer of the file contents (no Node buffer-pool aliasing). */
function readFixture(fullPath) {
    const buffer = fs.readFileSync(fullPath);
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );
}

/**
 * Offset of the first body byte of a part-10 stream: preamble (128) +
 * "DICM" (4) + the (0002,0000) FileMetaInformationGroupLength element
 * (12 bytes, explicit little endian UL) + the meta group it measures.
 */
function bodyStartOf(bytes) {
    const ascii = String.fromCharCode(...bytes.subarray(128, 132));
    if (ascii !== "DICM") {
        throw new Error("not a part-10 stream");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    if (
        view.getUint16(132, true) !== 0x0002 ||
        view.getUint16(134, true) !== 0
    ) {
        throw new Error("meta group length element missing");
    }
    return 144 + view.getUint32(140, true);
}

/** First index at which the byte sequences differ, or -1 when identical. */
function firstDifference(a, b) {
    const minLength = Math.min(a.length, b.length);
    for (let i = 0; i < minLength; i++) {
        if (a[i] !== b[i]) {
            return i;
        }
    }
    return a.length === b.length ? -1 : minLength;
}

function hexContext(bytes, offset) {
    const start = Math.max(0, offset - 8);
    return Array.from(bytes.subarray(start, start + 32))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join(" ");
}

/**
 * Asserts byte identity, reporting the first divergent offset plus 32
 * bytes of hex context on both sides on failure.
 */
function expectIdenticalBytes(actual, expected, label) {
    const diff = firstDifference(actual, expected);
    if (diff !== -1) {
        throw new Error(
            `${label}: bytes diverge at offset ${diff} ` +
                `(actual length ${actual.length}, expected length ${expected.length})\n` +
                `  actual   [${Math.max(0, diff - 8)}..]: ${hexContext(
                    actual,
                    diff
                )}\n` +
                `  expected [${Math.max(0, diff - 8)}..]: ${hexContext(
                    expected,
                    diff
                )}`
        );
    }
}

/**
 * The writer's exact re-encoding of the dict's (rewritten) top-level
 * SpecificCharacterSet entry under the given transfer syntax.
 */
function reencodedCharsetElement(entry, syntax) {
    const scratch = new WriteBufferStream(64, true);
    const values = DicomMessage._getTagWriteValues(entry.vr, entry);
    Tag.fromString("00080005").write(scratch, entry.vr, values, syntax, {});
    return new Uint8Array(scratch.getBuffer());
}

/**
 * The body bytes dicomDict.write() must produce for an unedited
 * passthrough-safe dict: the source body verbatim, with the re-encoded
 * 0008,0005 element spliced over its source span when present (its lazy
 * entry carries the ISO_IR 192 rewrite and no _sourceSpan, so it always
 * re-encodes - see the module docblock).
 */
function expectedBodyFor(srcBytes, srcBodyStart, dicomDict) {
    const srcBody = srcBytes.subarray(srcBodyStart);
    const entry = dicomDict.dict["00080005"];
    if (!entry) {
        return srcBody;
    }
    const csElement = parseDicom(srcBytes).elements.x00080005;
    expect(csElement).toBeDefined();
    const reencoded = reencodedCharsetElement(
        entry,
        dicomDict._lazyWriteContext.sourceSyntax
    );
    const spliceStart = csElement.startOffset - srcBodyStart;
    const spliceEnd = csElement.endOffset - srcBodyStart;
    const expected = new Uint8Array(
        srcBody.length - (spliceEnd - spliceStart) + reencoded.length
    );
    expected.set(srcBody.subarray(0, spliceStart), 0);
    expected.set(reencoded, spliceStart);
    expected.set(srcBody.subarray(spliceEnd), spliceStart + reencoded.length);
    return expected;
}

/** Reads with the lazy core; never falls back silently in these tests. */
function readLazy(arrayBuffer, options = {}) {
    return DicomMessage.readFile(arrayBuffer, { ...options, core: "lazy" });
}

/**
 * Classifies a fixture for the byte-identity suite. The reasons are the
 * complete, principled set - the classification test below fails if a new
 * fixture lands outside it.
 */
function classifyFixture(fullPath) {
    const arrayBuffer = readFixture(fullPath);
    let dicomDict;
    try {
        dicomDict = readLazy(arrayBuffer);
    } catch {
        return { reason: "parse-error" };
    }
    const context = dicomDict._lazyWriteContext;
    if (!context) {
        // tokenizer-rejected stream: the read delegated to the eager core
        return { reason: "eager-fallback" };
    }
    if (context.sourceSyntax === DEFLATED_TRANSFER_SYNTAX) {
        return { reason: "deflated" };
    }
    // An in-item SpecificCharacterSet rewrites to ISO_IR 192 when the item
    // materializes, so the enclosing SQ never passes through (W2:
    // _sqHasItemCharset) and the body cannot be byte-identical - a
    // principled divergence asserted narrowly in its own describe below.
    const hasInItemCharset = Object.keys(dicomDict.dict).some(tag => {
        const entry = dicomDict.dict[tag];
        return entry.vr === "SQ" && entry._sqHasItemCharset;
    });
    if (hasInItemCharset) {
        return { reason: "in-item-charset", arrayBuffer };
    }
    if (!context.charsetPassthroughSafe) {
        return { reason: "charset-unsafe", arrayBuffer };
    }
    return { reason: "eligible", arrayBuffer };
}

/**
 * Same-length charset neutralization: byte-patches the 0008,0005 VALUE
 * bytes to "ISO_IR 192" when the stored value has the same 10-byte length,
 * leaving every other byte of the file untouched. Returns null when the
 * fixture has no charset element of that exact length.
 */
function charsetNeutralizedCopy(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let csElement;
    try {
        csElement = parseDicom(bytes).elements.x00080005;
    } catch {
        return null;
    }
    if (!csElement || csElement.length !== UTF8_CHARSET.length) {
        return null;
    }
    const copy = arrayBuffer.slice(0);
    const copyBytes = new Uint8Array(copy);
    for (let i = 0; i < UTF8_CHARSET.length; i++) {
        copyBytes[csElement.dataOffset + i] = UTF8_CHARSET.charCodeAt(i);
    }
    return copy;
}

const classified = ALL_FIXTURES.map(([relPath, fullPath]) => ({
    relPath,
    fullPath,
    ...classifyFixture(fullPath)
}));

const eligible = classified.filter(fixture => fixture.reason === "eligible");
const neutralizable = classified
    .filter(fixture => fixture.reason === "charset-unsafe")
    .map(fixture => ({
        ...fixture,
        neutralized: charsetNeutralizedCopy(fixture.arrayBuffer)
    }))
    .filter(fixture => fixture.neutralized);
const inItemCharset = classified.filter(
    fixture => fixture.reason === "in-item-charset"
);

function assertNoEditWriteIsBodyIdentical(arrayBuffer, label) {
    const dicomDict = readLazy(arrayBuffer);
    expect(dicomDict._lazyWriteContext).toBeDefined();
    expect(dicomDict._lazyWriteContext.charsetPassthroughSafe).toBe(true);

    const out = new Uint8Array(dicomDict.write());
    const srcBytes = new Uint8Array(arrayBuffer);
    const srcBodyStart = bodyStartOf(srcBytes);
    const outBodyStart = bodyStartOf(out);

    const expected = expectedBodyFor(srcBytes, srcBodyStart, dicomDict);
    expectIdenticalBytes(out.subarray(outBodyStart), expected, label);
}

describe("W3 passthrough: fixture classification", () => {
    it("classifies every discovered fixture into a documented bucket", () => {
        const knownReasons = new Set([
            "eligible",
            "charset-unsafe",
            "in-item-charset",
            "deflated",
            "eager-fallback",
            "parse-error"
        ]);
        for (const fixture of classified) {
            expect(knownReasons.has(fixture.reason)).toBe(true);
        }
    });

    it("finds a non-trivial corpus for both byte-identity tiers", () => {
        // direct tier: cine-test, invalid-vr-length-test, sample-sr today
        expect(eligible.length).toBeGreaterThanOrEqual(3);
        // neutralized tier covers the structural zoo (encapsulated,
        // fragmented, BOT, RLE, big endian, implicit + explicit)
        expect(neutralizable.length).toBeGreaterThanOrEqual(15);
        expect(
            neutralizable.some(fixture =>
                fixture.relPath.includes("IM00001.implicit_little_endian")
            )
        ).toBe(true);
    });
});

describe("W3 passthrough: no-edit write is body byte-identical", () => {
    eligible.forEach(fixture => {
        it(`reproduces the source body exactly: ${fixture.relPath}`, () => {
            assertNoEditWriteIsBodyIdentical(
                fixture.arrayBuffer,
                fixture.relPath
            );
        });
    });

    neutralizable.forEach(fixture => {
        it(`reproduces the source body exactly (charset-neutralized): ${fixture.relPath}`, () => {
            assertNoEditWriteIsBodyIdentical(
                fixture.neutralized,
                `${fixture.relPath} (charset-neutralized)`
            );
        });
    });
});

describe("W3 passthrough: principled divergence - in-item SpecificCharacterSet", () => {
    /**
     * Fixtures whose sequence items carry their own 0008,0005 CANNOT be
     * body byte-identical: materializing such an item rewrites the stored
     * charset to ["ISO_IR 192"] (normalize-on-read, kept per R5), so W2's
     * _sqHasItemCharset flag makes the enclosing SQ re-encode. The
     * divergence is asserted narrowly: the body is identical up to the
     * first charset-bearing SQ, every clean entry's span still survives
     * verbatim in the output, and both cores agree on the re-parse.
     */
    inItemCharset.forEach(fixture => {
        it(`re-encodes only the charset-bearing SQ subtrees: ${fixture.relPath}`, () => {
            const arrayBuffer =
                charsetNeutralizedCopy(fixture.arrayBuffer) ||
                fixture.arrayBuffer;
            const dicomDict = readLazy(arrayBuffer);
            expect(dicomDict._lazyWriteContext.charsetPassthroughSafe).toBe(
                true
            );

            const dirtySqSpans = [];
            const cleanSpans = [];
            for (const tag of Object.keys(dicomDict.dict)) {
                const entry = dicomDict.dict[tag];
                if (entry.vr === "SQ" && entry._sqHasItemCharset) {
                    dirtySqSpans.push(entry._sourceSpan);
                } else if (entry._sourceSpan) {
                    cleanSpans.push(entry._sourceSpan);
                }
            }
            // the documented reason is real for this fixture
            expect(dirtySqSpans.length).toBeGreaterThan(0);

            const srcBytes = new Uint8Array(arrayBuffer);
            const srcBodyStart = bodyStartOf(srcBytes);
            const out = new Uint8Array(dicomDict.write());
            const outBody = out.subarray(bodyStartOf(out));

            // byte-identical up to the first re-encoded (charset-bearing)
            // SQ element
            const firstDirtyStart =
                Math.min(...dirtySqSpans.map(span => span.startOffset)) -
                srcBodyStart;
            expectIdenticalBytes(
                outBody.subarray(0, firstDirtyStart),
                srcBytes.subarray(srcBodyStart, srcBodyStart + firstDirtyStart),
                "bytes before the first charset-bearing SQ"
            );

            // every clean span (PixelData run included) survives verbatim
            // somewhere in the output despite the SQ length shifts
            const outBuffer = Buffer.from(
                outBody.buffer,
                outBody.byteOffset,
                outBody.byteLength
            );
            for (const span of cleanSpans) {
                const spanBytes = Buffer.from(
                    span.buffer.buffer,
                    span.buffer.byteOffset + span.startOffset,
                    span.endOffset - span.startOffset
                );
                expect(outBuffer.indexOf(spanBytes)).not.toBe(-1);
            }

            // both cores agree on the rewritten stream
            const outEager = DicomMessage.readFile(out.buffer.slice(0), {
                core: "eager"
            });
            const outLazy = readLazy(out.buffer.slice(0));
            expect(
                collectSectionProblems(outEager.dict, outLazy.dict, "dict", [])
            ).toEqual([]);
        });
    });
});

describe("W3 passthrough: edit correctness", () => {
    const PATIENT_NAME = "00100010";

    it("a same-length PatientName edit changes only that element's bytes (cine-test.dcm, implicit)", () => {
        const arrayBuffer = readFixture(path.join(__dirname, "cine-test.dcm"));
        const dicomDict = readLazy(arrayBuffer);
        const entry = dicomDict.dict[PATIENT_NAME];
        expect(entry).toBeDefined();

        // capture spans BEFORE the edit (the edit leaves _sourceSpan in
        // place but flips _dirty)
        const pnSpan = { ...entry._sourceSpan };
        const cleanSpans = Object.keys(dicomDict.dict)
            .filter(tag => tag !== PATIENT_NAME)
            .map(tag => dicomDict.dict[tag]._sourceSpan)
            .filter(Boolean)
            .map(span => ({ ...span }));
        // the fixture's structural zoo must be represented: undefined-length
        // SQ subtrees and the (native, implicit OW) PixelData run
        expect(dicomDict.dict["52009230"].vr).toBe("SQ");
        expect(dicomDict.dict["7FE00010"]).toBeDefined();

        const srcBytes = new Uint8Array(arrayBuffer);
        const srcBodyStart = bodyStartOf(srcBytes);
        // implicit LE PN header is 8 bytes (tag + 32 bit length)
        const valueLength = pnSpan.endOffset - pnSpan.startOffset - 8;
        expect(valueLength).toBeGreaterThan(0);
        expect(valueLength % 2).toBe(0);
        const newName = "X".repeat(valueLength);
        entry.Value = [newName];

        const out = new Uint8Array(dicomDict.write());
        const outBodyStart = bodyStartOf(out);
        const outBody = out.subarray(outBodyStart);
        const srcBody = srcBytes.subarray(srcBodyStart);
        expect(outBody.length).toBe(srcBody.length);

        const editStart = pnSpan.startOffset - srcBodyStart;
        const editEnd = pnSpan.endOffset - srcBodyStart;
        // bytes outside the edited element are untouched
        expectIdenticalBytes(
            outBody.subarray(0, editStart),
            srcBody.subarray(0, editStart),
            "bytes before the edited element"
        );
        expectIdenticalBytes(
            outBody.subarray(editEnd),
            srcBody.subarray(editEnd),
            "bytes after the edited element"
        );
        // the edited window is exactly the writer's re-encoding
        const scratch = new WriteBufferStream(64, true);
        Tag.fromString(PATIENT_NAME).write(
            scratch,
            "PN",
            DicomMessage._getTagWriteValues("PN", entry),
            dicomDict._lazyWriteContext.sourceSyntax,
            {}
        );
        expectIdenticalBytes(
            outBody.subarray(editStart, editEnd),
            new Uint8Array(scratch.getBuffer()),
            "the edited element window"
        );

        // every untouched span (incl. whole undefined-length SQ subtrees
        // and the PixelData run) survives byte-identical, span by span
        for (const span of cleanSpans) {
            expectIdenticalBytes(
                outBody.subarray(
                    span.startOffset - srcBodyStart,
                    span.endOffset - srcBodyStart
                ),
                srcBytes.subarray(span.startOffset, span.endOffset),
                `untouched span at ${span.startOffset}`
            );
        }

        // re-parse with BOTH cores: the dicts agree with each other and
        // with the source dict everywhere except the edited element
        const outEager = DicomMessage.readFile(out.buffer.slice(0), {
            core: "eager"
        });
        const outLazy = readLazy(out.buffer.slice(0));
        expect(
            collectSectionProblems(outEager.dict, outLazy.dict, "dict", [])
        ).toEqual([]);
        expect(
            collectSectionProblems(outEager.meta, outLazy.meta, "meta", [])
        ).toEqual([]);
        // PN values re-read as dicom+json person-name objects
        expect(outEager.dict[PATIENT_NAME].Value[0].Alphabetic).toBe(newName);

        const srcEager = DicomMessage.readFile(arrayBuffer.slice(0), {
            core: "eager"
        });
        const srcDictWithoutEdit = { ...srcEager.dict };
        const outDictWithoutEdit = { ...outEager.dict };
        delete srcDictWithoutEdit[PATIENT_NAME];
        delete outDictWithoutEdit[PATIENT_NAME];
        expect(
            collectSectionProblems(
                srcDictWithoutEdit,
                outDictWithoutEdit,
                "dict-minus-edit",
                []
            )
        ).toEqual([]);
    });

    it("a length-changing PatientName edit shifts but does not alter untouched spans (IM00001 encapsulated, charset-neutralized)", () => {
        const fixture = neutralizable.find(candidate =>
            candidate.relPath.includes(
                "IM00001.fragmented_no_bot_jpeg_baseline"
            )
        );
        expect(fixture).toBeDefined();
        const arrayBuffer = fixture.neutralized;
        const dicomDict = readLazy(arrayBuffer);
        const entry = dicomDict.dict[PATIENT_NAME];
        expect(entry).toBeDefined();

        const pnSpan = { ...entry._sourceSpan };
        // untouched spans to track across the shift: every clean span,
        // notably the SQ subtrees and the ENTIRE encapsulated PixelData run
        // (basic offset table + all fragments + delimiter)
        const trackedSpans = Object.keys(dicomDict.dict)
            .filter(tag => tag !== PATIENT_NAME)
            .map(tag => ({
                tag,
                vr: dicomDict.dict[tag].vr,
                span: dicomDict.dict[tag]._sourceSpan
            }))
            .filter(tracked => tracked.span);
        expect(trackedSpans.some(tracked => tracked.vr === "SQ")).toBe(true);
        expect(trackedSpans.some(tracked => tracked.tag === "7FE00010")).toBe(
            true
        );

        const srcBytes = new Uint8Array(arrayBuffer);
        const srcBodyStart = bodyStartOf(srcBytes);
        const newName = "Edited^Passthrough^MuchLongerThanBefore";
        entry.Value = [newName];

        const out = new Uint8Array(dicomDict.write());
        const outBodyStart = bodyStartOf(out);
        const outBody = out.subarray(outBodyStart);
        const srcBody = srcBytes.subarray(srcBodyStart);
        const delta = outBody.length - srcBody.length;
        expect(delta).not.toBe(0);

        const editStart = pnSpan.startOffset - srcBodyStart;
        const editEnd = pnSpan.endOffset - srcBodyStart;
        expectIdenticalBytes(
            outBody.subarray(0, editStart),
            srcBody.subarray(0, editStart),
            "bytes before the edited element"
        );
        expectIdenticalBytes(
            outBody.subarray(editEnd + delta),
            srcBody.subarray(editEnd),
            "bytes after the edited element (shifted)"
        );

        for (const tracked of trackedSpans) {
            const shift =
                tracked.span.startOffset >= pnSpan.endOffset ? delta : 0;
            expectIdenticalBytes(
                outBody.subarray(
                    tracked.span.startOffset - srcBodyStart + shift,
                    tracked.span.endOffset - srcBodyStart + shift
                ),
                srcBytes.subarray(
                    tracked.span.startOffset,
                    tracked.span.endOffset
                ),
                `untouched span ${tracked.tag}`
            );
        }

        // re-parse with BOTH cores and deep-compare against the edited
        // expectation (the source dict with only PatientName changed)
        const outEager = DicomMessage.readFile(out.buffer.slice(0), {
            core: "eager"
        });
        const outLazy = readLazy(out.buffer.slice(0));
        expect(
            collectSectionProblems(outEager.dict, outLazy.dict, "dict", [])
        ).toEqual([]);
        // PN values re-read as dicom+json person-name objects
        expect(outEager.dict[PATIENT_NAME].Value[0].Alphabetic).toBe(newName);
        expect(outLazy.dict[PATIENT_NAME].Value[0].Alphabetic).toBe(newName);

        const srcEager = DicomMessage.readFile(arrayBuffer.slice(0), {
            core: "eager"
        });
        const srcDictWithoutEdit = { ...srcEager.dict };
        const outDictWithoutEdit = { ...outEager.dict };
        delete srcDictWithoutEdit[PATIENT_NAME];
        delete outDictWithoutEdit[PATIENT_NAME];
        expect(
            collectSectionProblems(
                srcDictWithoutEdit,
                outDictWithoutEdit,
                "dict-minus-edit",
                []
            )
        ).toEqual([]);
        expect(
            collectSectionProblems(srcEager.meta, outEager.meta, "meta", [])
        ).toEqual([]);
    });
});

describe("W3 passthrough: performance report", () => {
    function timeWrite(arrayBuffer, forceReencode, repetitions = 7) {
        let best = Infinity;
        let outLength = 0;
        for (let i = 0; i < repetitions; i++) {
            const dicomDict = readLazy(arrayBuffer);
            if (forceReencode) {
                // _lazyWriteContext is configurable for exactly this:
                // removing it forces the historical full re-encode
                delete dicomDict._lazyWriteContext;
            }
            const start = process.hrtime.bigint();
            const out = dicomDict.write();
            const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
            outLength = out.byteLength;
            best = Math.min(best, elapsed);
        }
        return { best, outLength };
    }

    it("times a no-edit rewrite of IM00001 implicit (1.8MB): passthrough vs forced re-encode", () => {
        const fixture = neutralizable.find(candidate =>
            candidate.relPath.includes("IM00001.implicit_little_endian")
        );
        expect(fixture).toBeDefined();
        // charset-neutralized copy: the original declares ISO-IR 100 which
        // disables the dict-level passthrough gate (see module docblock)
        const passthrough = timeWrite(fixture.neutralized, false);
        const reencode = timeWrite(fixture.neutralized, true);
        console.log(
            "IM00001.implicit_little_endian (1.8MB, charset-neutralized) no-edit rewrite: " +
                `passthrough ${passthrough.best.toFixed(2)} ms ` +
                `(${passthrough.outLength} bytes) vs forced re-encode ` +
                `${reencode.best.toFixed(2)} ms (${reencode.outLength} bytes)`
        );
        expect(passthrough.outLength).toBeGreaterThan(0);
        expect(reencode.outLength).toBeGreaterThan(0);
    });

    it("times a no-edit rewrite of cine-test.dcm (1.05MB, charset-safe as-is)", () => {
        const arrayBuffer = readFixture(path.join(__dirname, "cine-test.dcm"));
        const passthrough = timeWrite(arrayBuffer, false);
        const reencode = timeWrite(arrayBuffer, true);
        console.log(
            "cine-test.dcm (1.05MB) no-edit rewrite: " +
                `passthrough ${passthrough.best.toFixed(2)} ms vs ` +
                `forced re-encode ${reencode.best.toFixed(2)} ms`
        );
        expect(passthrough.outLength).toBeGreaterThan(0);
        expect(reencode.outLength).toBeGreaterThan(0);
    });
});
