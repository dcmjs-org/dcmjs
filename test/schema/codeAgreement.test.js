// D22 code-agreement gate: everything NaturalizedListener produces across the
// corpus must satisfy the catalog's shape rules. Schema-says-X-code-does-Y
// fails in either direction (for produced keys).
import fs from "fs";
import path from "path";
import { naturalizedRules } from "../../src/schema/naturalizedRules.js";
import { parseVm, VR_SCALAR, MULTI_VR } from "../../generate/schemaRules.mjs";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { fromPart10 } from "../../src/eventStream/fromPart10";

const REPO_ROOT = path.join(__dirname, "..", "..");
const PARSER_IMAGES_DIR = path.join(
    REPO_ROOT,
    "packages",
    "parser",
    "testImages"
);
const TEST_DIR = path.join(REPO_ROOT, "test");

function discover(dir, accept) {
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) out.push(...discover(full, accept));
        else if (stat.isFile() && accept(name)) out.push(full);
    }
    return out;
}

const FIXTURES = [
    ...discover(PARSER_IMAGES_DIR, n => !n.toLowerCase().endsWith(".md")),
    ...discover(TEST_DIR, n => /\.(dcm|dicom|lei)$/i.test(n))
].map(full => [path.relative(REPO_ROOT, full), full]);

function readBuffer(full) {
    const data = fs.readFileSync(full);
    return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
    );
}

const byKeyword = new Map(
    Object.entries(naturalizedRules.attributes).map(([tag, e]) => [
        e.keyword,
        { tag, ...e }
    ])
);

const PRIVATE_KEY = /:/; // '<slot>:<creator>' grouping (D2b)
const UNKNOWN_KEY = /^[0-9A-Fa-f]{8}$/; // preserved unknown tags (spec 12.3)

function isBinaryLike(vrs) {
    return vrs.some(vr => VR_SCALAR[vr] === "BinaryValue");
}

/**
 * Check one naturalized dataset (recursively) against the catalog.
 * `exempt` holds keywords the listener itself flagged as VM violations
 * (warnAndPreserve keeps non-conformant data — that is data
 * non-conformance, not schema/code disagreement).
 */
function checkDataset(ds, docPath, exempt, problems) {
    for (const [key, value] of Object.entries(ds)) {
        if (value === undefined || value === null) continue;
        if (key.startsWith("_")) continue; // internal metadata
        if (PRIVATE_KEY.test(key) || UNKNOWN_KEY.test(key)) continue;
        const rule = byKeyword.get(key);
        if (!rule) {
            problems.push(`${docPath}.${key}: key not in catalog`);
            continue;
        }
        const vrs = Array.isArray(rule.vr) ? rule.vr : [rule.vr];
        if (vrs.includes("SQ")) {
            if (!Array.isArray(value)) {
                problems.push(
                    `${docPath}.${key}: SQ must be an array (got ${typeof value})`
                );
            } else {
                value.forEach((item, i) =>
                    checkDataset(
                        item,
                        `${docPath}.${key}[${i}]`,
                        exempt,
                        problems
                    )
                );
            }
            continue;
        }
        if (isBinaryLike(vrs)) continue; // fragments/refs: envelope territory
        if (exempt.has(key)) continue; // listener-recorded VM violation
        const { multi } = parseVm(rule.vm);
        if (multi && !Array.isArray(value)) {
            problems.push(
                `${docPath}.${key}: VM ${rule.vm} must be an array (got ${typeof value})`
            );
        }
        if (!multi && Array.isArray(value)) {
            problems.push(`${docPath}.${key}: VM 1 must be a scalar (got array)`);
        }
    }
}

describe("D22 code-agreement gate — catalog vs NaturalizedListener", () => {
    test.each(FIXTURES)("catalog agrees on %s", async (_rel, full) => {
        const l = new NaturalizedListener();
        try {
            await fromPart10(readBuffer(full), l);
        } catch {
            return; // fixtures the readers reject are out of scope here
        }
        const exempt = new Set((l.violations || []).map(v => v.keyword));
        const problems = [];
        checkDataset(l.result, "$", exempt, problems);
        expect(problems).toEqual([]);
    });

    test("MULTI_VR members all map to a scalar", () => {
        for (const members of Object.values(MULTI_VR)) {
            for (const vr of members) {
                expect(VR_SCALAR[vr]).toBeDefined();
            }
        }
    });
});
