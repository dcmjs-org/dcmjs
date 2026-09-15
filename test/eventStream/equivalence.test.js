import fs from "fs";
import path from "path";
import dcmjs from "../../src/index.js";
import { deepCompare } from "../helper/equivalence.js";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { CollectorListener } from "../../src/eventStream/CollectorListener";
import { EventStreamListener } from "../../src/eventStream/EventStreamListener";

const { DicomMessage } = dcmjs.data;

/**
 * Slice-A primary gate: the event-stream contract must carry a real DICOM
 * dataset losslessly. For every local fixture we read it with dcmjs, replay it
 * through `fromDataSet` -> `CollectorListener`, and assert the rebuilt tree's
 * vr + Value match the source across the whole corpus (plain explicit/implicit
 * LE, big-endian, sequence-heavy, deflate, encapsulated/fragmented).
 *
 * `_rawValue` is intentionally NOT compared here — raw retention (§27) is a
 * slice-D concern, not part of the slice-A structural contract.
 */

const REPO_ROOT = path.join(__dirname, "..", "..");
const PARSER_IMAGES_DIR = path.join(REPO_ROOT, "packages", "parser", "testImages");
const TEST_DIR = path.join(REPO_ROOT, "test");

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

const FIXTURES = [
    ...discoverFixtures(PARSER_IMAGES_DIR, n => !n.toLowerCase().endsWith(".md")),
    ...discoverFixtures(TEST_DIR, n => /\.(dcm|dicom|lei)$/i.test(n))
].map(fullPath => [path.relative(REPO_ROOT, fullPath), fullPath]);

function readFixtureBuffer(fullPath) {
    const data = fs.readFileSync(fullPath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/**
 * Compare two tag-keyed sections, recursing into sequences so that only `vr`
 * and `Value` are ever compared. This deliberately ignores `_rawValue` (raw
 * retention, §27, is a slice-D concern) and any other non-contract entry keys.
 */
function compareSectionVrValue(src, dst, where, problems) {
    const srcTags = Object.keys(src).sort();
    const dstTags = Object.keys(dst).sort();
    if (srcTags.join(",") !== dstTags.join(",")) {
        problems.push(
            `${where}: tag sets differ\n  src: [${srcTags}]\n  out: [${dstTags}]`
        );
        return;
    }
    for (const tag of srcTags) {
        compareEntry(src[tag], dst[tag], `${where}.${tag}`, problems);
    }
}

function compareEntry(a, b, where, problems) {
    deepCompare(a.vr, b.vr, `${where}.vr`, problems);
    const av = a.Value || [];
    const bv = b.Value || [];
    if ((a.vr === "SQ" || a.vr === undefined) && av.some(isItemDict)) {
        if (av.length !== bv.length) {
            problems.push(`${where}.Value: length ${av.length} !== ${bv.length}`);
            return;
        }
        for (let i = 0; i < av.length; i++) {
            compareSectionVrValue(av[i], bv[i], `${where}.Value[${i}]`, problems);
        }
        return;
    }
    // Leaf values (primitives, strings/PN, buffers, {BulkDataURI}) are passed
    // through by reference, so a direct deep compare is exact.
    deepCompare(av, bv, `${where}.Value`, problems);
}

function isItemDict(v) {
    return (
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        !(v instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(v) &&
        v.BulkDataURI === undefined &&
        v.vr === undefined
    );
}

/** Compare vr + Value of every tag in a {meta, dict} pair. */
function compareTrees(source, rebuilt) {
    const problems = [];
    for (const section of ["meta", "dict"]) {
        compareSectionVrValue(
            source[section] || {},
            rebuilt[section] || {},
            section,
            problems
        );
    }
    return problems;
}

/** A listener that asserts start/end nesting stays balanced. */
class BalanceChecker extends EventStreamListener {
    constructor() {
        super();
        this.depth = 0;
        this.minDepth = 0;
        this.maxDepth = 0;
    }
    _enter() {
        this.depth++;
        if (this.depth > this.maxDepth) this.maxDepth = this.depth;
    }
    _leave() {
        this.depth--;
        if (this.depth < this.minDepth) this.minDepth = this.depth;
    }
    _baseStartSequence() {
        this._enter();
    }
    _baseEndSequence() {
        this._leave();
    }
    _baseStartItem() {
        this._enter();
    }
    _baseEndItem() {
        this._leave();
    }
    _baseStartBinary() {
        this._enter();
    }
    _baseEndBinary() {
        this._leave();
    }
}

describe("event-stream contract — corpus round-trip equivalence", () => {
    test("discovers fixtures to test", () => {
        expect(FIXTURES.length).toBeGreaterThan(0);
    });

    test.each(FIXTURES)("%s round-trips losslessly", async (_rel, fullPath) => {
        let source;
        try {
            source = DicomMessage.readFile(readFixtureBuffer(fullPath));
        } catch {
            // Fixtures both cores reject (e.g. sample-op.lei) are not valid
            // datasets to round-trip; nothing to assert.
            return;
        }

        const listener = new CollectorListener();
        await fromDataSet({ meta: source.meta, dict: source.dict }, listener);

        const problems = compareTrees(source, listener.result);
        expect(problems).toEqual([]);
    });

    test.each(FIXTURES)("%s emits well-formed (balanced) nesting", async (_rel, fullPath) => {
        let source;
        try {
            source = DicomMessage.readFile(readFixtureBuffer(fullPath));
        } catch {
            return;
        }
        const checker = new BalanceChecker();
        await fromDataSet({ meta: source.meta, dict: source.dict }, checker);
        expect(checker.depth).toBe(0);
        expect(checker.minDepth).toBe(0);
    });
});

describe("event-stream contract — loss preservation (§15.1)", () => {
    test("does not collapse a VM-1 element carrying multiple values", async () => {
        const dataset = {
            dict: { "00100020": { vr: "LO", Value: ["12345", "67890"] } }
        };
        const listener = new CollectorListener();
        await fromDataSet(dataset, listener);
        expect(listener.result.dict["00100020"].Value).toEqual(["12345", "67890"]);
    });

    test("does not discard extra items in a single-item sequence", async () => {
        const dataset = {
            dict: {
                "00081110": {
                    vr: "SQ",
                    Value: [
                        { "00081150": { vr: "UI", Value: ["A"] } },
                        { "00081150": { vr: "UI", Value: ["B"] } }
                    ]
                }
            }
        };
        const listener = new CollectorListener();
        await fromDataSet(dataset, listener);
        expect(listener.result.dict["00081110"].Value).toHaveLength(2);
        expect(listener.result.dict["00081110"].Value[1]["00081150"].Value).toEqual([
            "B"
        ]);
    });
});
