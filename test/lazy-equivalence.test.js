import fs from "fs";
import path from "path";
import dcmjs from "../src/index.js";
import { collectSectionProblems } from "./helper/equivalence.js";

const { DicomMessage } = dcmjs.data;

/**
 * Exhaustive lazy-vs-eager equivalence matrix (docs roadmap stage 3).
 *
 * Every local DICOM fixture on disk - the full packages/parser/testImages
 * tree (plain syntaxes, encapsulated single/multi-frame with and without
 * BOT and fragmentation, deflated) plus every DICOM binary under test/ -
 * is read with both cores under each option set, then meta + dict are
 * fully materialized and deep-compared (ArrayBuffer/typed-array bytes and
 * kinds, addTagAccessors proxies, PN boxing, null-vs-undefined).
 *
 * When the EAGER core throws, the lazy core must throw too; only error
 * presence is asserted, not message text (the lazy core delegates
 * tokenizer-rejected files to the eager core, so in practice the messages
 * match as well).
 *
 * Only files already on disk are used - nothing is downloaded.
 */

const REPO_ROOT = path.join(__dirname, "..");
const PARSER_IMAGES_DIR = path.join(
    REPO_ROOT,
    "packages",
    "parser",
    "testImages"
);
const TEST_DIR = __dirname;

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

// All parser test images are DICOM streams (the deflate fixtures have no
// extension and end in _dfl); only the READMEs are not fixtures.
const parserFixtures = discoverFixtures(
    PARSER_IMAGES_DIR,
    name => !name.toLowerCase().endsWith(".md")
);

// All local DICOM binaries under test/ (no recursion needed today, but the
// discovery is recursive so new fixtures in subdirectories are picked up).
// sample-op.lei (a headerless implicit-LE stream both cores reject) is
// DICOM data too and is deliberately included via the .lei extension.
const localFixtures = discoverFixtures(TEST_DIR, name =>
    /\.(dcm|dicom|lei)$/i.test(name)
);

const FIXTURES = [...parserFixtures, ...localFixtures].map(fullPath => [
    path.relative(REPO_ROOT, fullPath),
    fullPath
]);

// {} must stay first: it is the option set the byte-identical-default
// guarantee is about.
const OPTION_SETS = [
    ["default", {}],
    ["ignoreErrors", { ignoreErrors: true }],
    ["forceStoreRaw", { forceStoreRaw: true }],
    ["untilTag 00080060", { untilTag: "00080060" }],
    // bonus coverage beyond the required matrix: the lazy core mirrors
    // eager's noCopy value shapes (Uint8Array wrappers, fragment lists)
    ["noCopy", { noCopy: true }]
];

function readFixtureBuffer(fullPath) {
    const data = fs.readFileSync(fullPath);
    // standalone ArrayBuffer (node Buffers may be pooled views)
    return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
    );
}

function runCore(buffer, options, core) {
    try {
        return {
            dicomDict: DicomMessage.readFile(buffer.slice(0), {
                ...options,
                core
            })
        };
    } catch (error) {
        return { error };
    }
}

// ---------------------------------------------------------------------------
// Per-fixture, per-options pass/fail summary, printed when anything failed.
// ---------------------------------------------------------------------------
const summary = [];
let sawFailure = false;

afterAll(() => {
    if (!sawFailure) {
        return;
    }
    const lines = summary.map(
        ({ fixture, optionLabel, outcome }) =>
            `${
                outcome === "pass" ? "PASS" : "FAIL"
            }  ${fixture} :: ${optionLabel}${
                outcome === "pass" ? "" : ` -- ${outcome}`
            }`
    );
    console.log(
        "lazy-equivalence fixture/options matrix:\n" + lines.join("\n")
    );
});

function recordAndAssert(fixture, optionLabel, problems) {
    summary.push({
        fixture,
        optionLabel,
        outcome: problems.length === 0 ? "pass" : problems.join("; ")
    });
    if (problems.length > 0) {
        sawFailure = true;
    }
    expect(problems).toEqual([]);
}

describe("lazy/eager equivalence matrix", () => {
    test("fixture discovery found the expected corpus", () => {
        // 23 parser images (3 plain + 14 encapsulated + 3 deflate + the
        // explicit/implicit sources alongside them) and at least the 7
        // known local binaries; both directions guard against silent
        // discovery regressions.
        expect(parserFixtures.length).toBe(23);
        expect(localFixtures.length).toBeGreaterThanOrEqual(7);
    });

    describe.each(FIXTURES)("%s", (fixture, fullPath) => {
        let buffer;

        beforeAll(() => {
            buffer = readFixtureBuffer(fullPath);
        });

        afterAll(() => {
            buffer = null;
        });

        test.each(OPTION_SETS)("options: %s", (optionLabel, options) => {
            const eager = runCore(buffer, options, "eager");
            const lazy = runCore(buffer, options, "lazy");

            const problems = [];
            if (eager.error) {
                // error presence must match; message text is not asserted
                if (!lazy.error) {
                    problems.push(
                        `eager threw (${eager.error.message}) but lazy succeeded`
                    );
                }
            } else if (lazy.error) {
                problems.push(
                    `lazy threw (${lazy.error.message}) but eager succeeded`
                );
            } else {
                collectSectionProblems(
                    eager.dicomDict.meta,
                    lazy.dicomDict.meta,
                    "meta",
                    problems
                );
                collectSectionProblems(
                    eager.dicomDict.dict,
                    lazy.dicomDict.dict,
                    "dict",
                    problems
                );
            }

            recordAndAssert(fixture, optionLabel, problems);
        });
    });
});
