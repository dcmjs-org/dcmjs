import fs from "fs";
import path from "path";
import dcmjs from "../../src/index.js";
import { fromPart10 } from "../../src/eventStream/fromPart10";
import { CollectorListener } from "../../src/eventStream/CollectorListener";
import { deepCompare } from "../helper/equivalence.js";

const { DicomDict, DicomMessage } = dcmjs.data;

/** Build an in-memory Part 10 buffer from a meta + dict pair. */
function buildPart10(meta, dict) {
    const dd = new DicomDict(meta);
    dd.dict = dict;
    return dd.write();
}

/** SQ-aware vr+Value comparison (ignores _rawValue; raw retention is slice D). */
function compareTrees(source, rebuilt, exempt = new Set()) {
    const problems = [];
    // Group-length elements (gggg,0000) are loss-preservingly emitted by the
    // event stream but stripped by readFile (§33), so exempt them from the gate.
    const isGroupLength = tag => tag.slice(4) === "0000";
    const section = (src, dst, where) => {
        const sTags = Object.keys(src).filter(t => !isGroupLength(t)).sort();
        const dTags = Object.keys(dst).filter(t => !isGroupLength(t)).sort();
        if (sTags.join(",") !== dTags.join(",")) {
            problems.push(`${where}: tags [${sTags}] vs [${dTags}]`);
            return;
        }
        for (const tag of sTags) {
            if (exempt.has(tag)) continue;
            deepCompare(src[tag].vr, dst[tag].vr, `${where}.${tag}.vr`, problems);
            deepCompare(
                src[tag].Value,
                dst[tag].Value,
                `${where}.${tag}.Value`,
                problems
            );
        }
    };
    section(source.meta || {}, rebuilt.meta || {}, "meta");
    section(source.dict || {}, rebuilt.dict || {}, "dict");
    return problems;
}

describe("fromPart10 — explicit little endian scalars", () => {
    const meta = {
        "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] },
        "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
        "00020003": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9"] }
    };
    const dict = {
        "00080060": { vr: "CS", Value: ["CT"] },
        "00100010": { vr: "PN", Value: ["Doe^Jane"] },
        "00100020": { vr: "LO", Value: ["12345"] },
        "00200013": { vr: "IS", Value: [12] },
        "00080008": { vr: "CS", Value: ["ORIGINAL", "PRIMARY"] }
    };

    test("round-trips from raw bytes equivalently to readFile", async () => {
        const buffer = buildPart10(meta, dict);
        const source = DicomMessage.readFile(buffer.slice(0));

        const listener = new CollectorListener();
        await fromPart10(buffer.slice(0), listener);

        const problems = compareTrees(source, listener.result);
        expect(problems).toEqual([]);
    });
});

// --- slice J4a: undefined-length non-SQ element decoded natively -------------

/**
 * Build a minimal DICOM Part 10 file that contains a private UN element
 * (0099,0001) with undefined length and zero-length items, followed by a
 * sequence delimiter.  This is the "eagerWindow" hard-case in emitElement
 * (el.hadUndefinedLength, not SQ, not encapsulated pixel data) that
 * previously caused fromPart10 to throw HARD and delegate the whole file.
 *
 * The items deliberately have zero-length data so that @dcmjs/parser's
 * parseDicom call SUCCEEDS (parseDicomDataSetImplicit with maxPosition ==
 * currentPosition never iterates, avoiding the buffer-overrun that a 4-byte
 * implicit truncation would cause).  That lets the control flow reach
 * emitElement → HARD → delegate, rather than the outer parseDicom-catch →
 * delegate path, which is the path that the slice-J4a fix must eliminate.
 */
function buildUndefinedLengthFixture() {
    const meta = {
        "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] },
        "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
        "00020003": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9"] }
    };
    // buildPart10 with an empty dict produces a file with just the meta group.
    const base = buildPart10(meta, {});

    // Append a private UN element (0099,0001) with undefined length.
    // Structure: tag(4) + VR"UN"(2) + reserved(2) + len(4=0xFFFFFFFF)
    //            + empty-offset-table item (FFFE,E000, len=0, 8 bytes)
    //            + zero-length data item  (FFFE,E000, len=0, 8 bytes)
    //            + sequence delimiter     (FFFE,E0DD, len=0, 8 bytes)
    // Total appended: 12 + 8 + 8 + 8 = 36 bytes.
    const unElement = new Uint8Array([
        // Tag (0099,0001) little-endian
        0x99, 0x00, 0x01, 0x00,
        // VR "UN"
        0x55, 0x4e,
        // Reserved
        0x00, 0x00,
        // Undefined length (0xFFFFFFFF)
        0xff, 0xff, 0xff, 0xff,
        // Empty offset-table item (FFFE,E000, length 0)
        0xfe, 0xff, 0x00, 0xe0,
        0x00, 0x00, 0x00, 0x00,
        // Zero-length data item (FFFE,E000, length 0)
        0xfe, 0xff, 0x00, 0xe0,
        0x00, 0x00, 0x00, 0x00,
        // Sequence delimiter (FFFE,E0DD, length 0)
        0xfe, 0xff, 0xdd, 0xe0,
        0x00, 0x00, 0x00, 0x00
    ]);
    const baseBytes = new Uint8Array(base);
    const out = new Uint8Array(baseBytes.length + unElement.length);
    out.set(baseBytes);
    out.set(unElement, baseBytes.length);
    return out.buffer;
}

describe("fromPart10 — undefined-length non-SQ element (slice J4a)", () => {
    test("does not call DicomMessage.readFile for undefined-length non-SQ element", async () => {
        // RED before fix: fromPart10 throws HARD on el.hadUndefinedLength and
        // delegates to DicomMessage.readFile.  After fix it decodes natively.
        const buffer = buildUndefinedLengthFixture();
        const readFileSpy = jest.spyOn(DicomMessage, "readFile");
        let readFileCallCount = 0;
        try {
            const listener = new CollectorListener();
            await fromPart10(buffer, listener);
        } finally {
            // Capture BEFORE mockRestore — mockRestore internally calls mockReset()
            // which clears mock.calls, so any assertion after mockRestore sees 0.
            readFileCallCount = readFileSpy.mock.calls.length;
            readFileSpy.mockRestore();
        }
        expect(readFileCallCount).toBe(0);
    });

    test("produces the same output as DicomMessage.readFile for undefined-length non-SQ element", async () => {
        const buffer = buildUndefinedLengthFixture();
        const source = DicomMessage.readFile(buffer.slice(0));

        const listener = new CollectorListener();
        await fromPart10(buffer.slice(0), listener);

        const problems = compareTrees(source, listener.result);
        expect(problems).toEqual([]);
    });
});

// --- corpus gate: raw bytes -> events, equivalent to readFile ---------------

const REPO_ROOT = path.join(__dirname, "..", "..");
const PARSER_IMAGES_DIR = path.join(REPO_ROOT, "packages", "parser", "testImages");
const TEST_DIR = path.join(REPO_ROOT, "test");

function discoverFixtures(dir, accept) {
    const found = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) found.push(...discoverFixtures(full, accept));
        else if (stat.isFile() && accept(name)) found.push(full);
    }
    return found;
}

const FIXTURES = [
    ...discoverFixtures(PARSER_IMAGES_DIR, n => !n.toLowerCase().endsWith(".md")),
    ...discoverFixtures(TEST_DIR, n => /\.(dcm|dicom|lei)$/i.test(n))
].map(full => [path.relative(REPO_ROOT, full), full]);

// Deflate-specific fixtures for slice J4b gate.
const DEFLATE_FIXTURES = discoverFixtures(
    path.join(PARSER_IMAGES_DIR, "deflate"),
    n => !n.toLowerCase().endsWith(".md")
).map(full => [path.relative(REPO_ROOT, full), full]);

function readBuffer(full) {
    const data = fs.readFileSync(full);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

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

function compareSection(src, dst, where, problems) {
    const sTags = Object.keys(src).filter(t => !isGroupLength(t)).sort();
    const dTags = Object.keys(dst).filter(t => !isGroupLength(t)).sort();
    if (sTags.join(",") !== dTags.join(",")) {
        problems.push(`${where}: tags [${sTags}] vs [${dTags}]`);
        return;
    }
    for (const tag of sTags) {
        if (EXEMPT.has(tag)) continue;
        compareEntry(src[tag], dst[tag], `${where}.${tag}`, problems);
    }
}

function compareEntry(a, b, where, problems) {
    deepCompare(a.vr, b.vr, `${where}.vr`, problems);
    const av = a.Value || [];
    const bv = b.Value || [];
    if (isBinaryValue(av) || isBinaryValue(bv)) {
        const ab = concatBytes(av);
        const bb = concatBytes(bv);
        if (ab.length !== bb.length) {
            problems.push(`${where}.Value: binary length ${ab.length} !== ${bb.length}`);
            return;
        }
        for (let i = 0; i < ab.length; i++) {
            if (ab[i] !== bb[i]) {
                problems.push(`${where}.Value: binary bytes differ at ${i}`);
                return;
            }
        }
        return;
    }
    if (av.some(isItemDict)) {
        if (av.length !== bv.length) {
            problems.push(`${where}.Value: items ${av.length} !== ${bv.length}`);
            return;
        }
        for (let i = 0; i < av.length; i++) {
            compareSection(av[i], bv[i], `${where}.Value[${i}]`, problems);
        }
        return;
    }
    deepCompare(av, bv, `${where}.Value`, problems);
}

// --- slice J4b: deflate transfer syntax decoded natively --------------------

describe("fromPart10 — deflate native (slice J4b)", () => {
    test.each(DEFLATE_FIXTURES)(
        "%s — native decode (no readFile delegation)",
        async (_rel, full) => {
            let source;
            try {
                source = DicomMessage.readFile(readBuffer(full));
            } catch {
                return; // skip files both cores reject
            }

            let readFileCallCount = 0;
            const readFileSpy = jest.spyOn(DicomMessage, "readFile");
            try {
                const listener = new CollectorListener();
                await fromPart10(readBuffer(full), listener);
                // Capture before mockRestore (mockRestore clears mock.calls).
                readFileCallCount = readFileSpy.mock.calls.length;

                const problems = [];
                compareSection(
                    source.meta || {},
                    listener.result.meta || {},
                    "meta",
                    problems
                );
                compareSection(
                    source.dict || {},
                    listener.result.dict || {},
                    "dict",
                    problems
                );
                expect(problems).toEqual([]);
            } finally {
                readFileSpy.mockRestore();
            }
            // RED before fix: deflate files delegated to readFile (1+ calls).
            // GREEN after fix: seedReadContext handles inflation natively.
            expect(readFileCallCount).toBe(0);
        }
    );
});

// --- corpus gate: raw bytes -> events, equivalent to readFile ---------------

describe("fromPart10 — corpus round-trip equivalence (raw bytes -> events)", () => {
    test.each(FIXTURES)("%s", async (_rel, full) => {
        let source;
        try {
            source = DicomMessage.readFile(readBuffer(full));
        } catch {
            return; // fixtures both cores reject
        }
        const listener = new CollectorListener();
        await fromPart10(readBuffer(full), listener);

        const problems = [];
        compareSection(source.meta || {}, listener.result.meta || {}, "meta", problems);
        compareSection(source.dict || {}, listener.result.dict || {}, "dict", problems);
        expect(problems).toEqual([]);
    });
});
