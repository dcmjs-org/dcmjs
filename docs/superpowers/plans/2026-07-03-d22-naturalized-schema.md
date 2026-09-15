# D22 Naturalized Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a machine-readable rule catalog of the naturalized DICOM representation from the packed dictionary, with TypeScript and JSON-Schema projections, three CI gates, and a `dcmjs/schema` subpath export.

**Architecture:** One generator (`generate/generate-schema.mjs`, following the existing `generate/` codegen conventions) reads `getAllStandardTagEntries()` and emits three committed artifacts: the normative catalog (`src/schema/naturalizedRules.js`), the TS projection (`types/dcmjs-schema.d.ts`), and the JSON-Schema projection (`schema/naturalized.schema.json`). Tests gate code-agreement (NaturalizedListener output vs catalog), type correctness (tsc), and determinism (regenerate → diff-clean).

**Tech Stack:** Node ESM (`.mjs` generator), Jest (existing runner, babel-transformed ESM), TypeScript (new devDependency, `tsc --noEmit` gate only — no TS source code).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-03-d22-naturalized-schema-design.md`
- Generated artifacts are **committed**; the generator must be deterministic (no timestamps, no randomness; stable key order)
- The generator **fails loudly** (`process.exit(1)` with a message) on any VR or VM pattern it cannot classify — no silent skips
- Dictionary tag format from `getAllStandardTagEntries()` is `"(0008,0008)"` — catalog keys are bare 8-hex uppercase `"00080008"`
- Group `FFFE` entries (VR `na`: Item, ItemDelimitationItem, SequenceDelimitationItem) are structural, not data elements — excluded via an explicit exceptions list
- Multi-VR code mapping (exhaustive, from the packed dictionary): `xs` → `["US","SS"]`, `ox` → `["OB","OW"]`, `up` → `["UL"]`, `lt` → `["OW","US","SS"]`
- Test commands: `npx jest test/schema/ --testTimeout 60000` for new tests; full suite `pnpm test`
- Commit after every green task; commit messages follow `feat(schema): …` / `test(schema): …` / `docs(schema): …`

---

### Task 1: Rule primitives — VM pattern parser and VR maps

**Files:**
- Create: `generate/schemaRules.mjs`
- Test: `test/schema/schemaRules.test.js`

**Interfaces:**
- Produces: `parseVm(vm: string) -> {min: number, max: number|null, multiple: number|null, multi: boolean}` (`max: null` = unbounded; `multi` = container is an array)
- Produces: `VR_SCALAR: Record<string, string>` mapping every single VR code to a TS scalar type string (`"string" | "number" | "PersonName" | "NaturalizedDataset[]" | "BinaryValue"`)
- Produces: `MULTI_VR: Record<string, string[]>` (the four codes above)
- Produces: `VR_FORMATS: Record<string, {pattern?: string, maxLength?: number}>`
- Produces: `EXCLUDED_TAGS: Set<string>` (bare-hex FFFE group entries)

- [ ] **Step 1: Write the failing test**

```js
// test/schema/schemaRules.test.js
import {
    parseVm,
    VR_SCALAR,
    MULTI_VR,
    VR_FORMATS,
    EXCLUDED_TAGS
} from "../../generate/schemaRules.mjs";

describe("parseVm", () => {
    test.each([
        ["1",    { min: 1, max: 1, multiple: null, multi: false }],
        ["2",    { min: 2, max: 2, multiple: null, multi: true }],
        ["16",   { min: 16, max: 16, multiple: null, multi: true }],
        ["1-n",  { min: 1, max: null, multiple: null, multi: true }],
        ["2-n",  { min: 2, max: null, multiple: null, multi: true }],
        ["1-8",  { min: 1, max: 8, multiple: null, multi: true }],
        ["1-99", { min: 1, max: 99, multiple: null, multi: true }],
        ["3-3n", { min: 3, max: null, multiple: 3, multi: true }],
        ["2-2n", { min: 2, max: null, multiple: 2, multi: true }],
        ["6-n",  { min: 6, max: null, multiple: null, multi: true }]
    ])("parses %s", (vm, expected) => {
        expect(parseVm(vm)).toEqual(expected);
    });

    test("throws on unclassifiable VM", () => {
        expect(() => parseVm("banana")).toThrow(/unclassifiable VM/i);
    });
});

describe("VR maps", () => {
    test("scalar map covers the string/number/PN/SQ/binary split", () => {
        expect(VR_SCALAR.CS).toBe("string");
        expect(VR_SCALAR.DA).toBe("string");
        expect(VR_SCALAR.AT).toBe("string");
        expect(VR_SCALAR.DS).toBe("number");
        expect(VR_SCALAR.US).toBe("number");
        expect(VR_SCALAR.PN).toBe("PersonName");
        expect(VR_SCALAR.SQ).toBe("NaturalizedDataset[]");
        // Binary byte VRs are blobs, not numbers (decision log D9)
        for (const vr of ["OB", "OW", "OF", "OD", "OL", "OV", "UN"]) {
            expect(VR_SCALAR[vr]).toBe("BinaryValue");
        }
        // 64-bit integers may exceed Number.MAX_SAFE_INTEGER (D14)
        expect(VR_SCALAR.UV).toBe("number | string");
        expect(VR_SCALAR.SV).toBe("number | string");
    });

    test("multi-VR codes map to explicit unions", () => {
        expect(MULTI_VR.xs).toEqual(["US", "SS"]);
        expect(MULTI_VR.ox).toEqual(["OB", "OW"]);
        expect(MULTI_VR.up).toEqual(["UL"]);
        expect(MULTI_VR.lt).toEqual(["OW", "US", "SS"]);
    });

    test("VR formats encode Part 5 constraints", () => {
        expect(VR_FORMATS.DA).toEqual({ pattern: "^\\d{8}$" });
        expect(VR_FORMATS.IS).toEqual({ maxLength: 12, pattern: "^[+-]?\\d+$" });
        expect(VR_FORMATS.DS).toEqual({ maxLength: 16 });
        expect(VR_FORMATS.UI).toEqual({ maxLength: 64, pattern: "^[0-9.]+$" });
        expect(VR_FORMATS.AS).toEqual({ pattern: "^\\d{3}[DWMY]$" });
    });

    test("FFFE structural items are excluded", () => {
        expect(EXCLUDED_TAGS.has("FFFEE000")).toBe(true);
        expect(EXCLUDED_TAGS.has("FFFEE00D")).toBe(true);
        expect(EXCLUDED_TAGS.has("FFFEE0DD")).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/schema/schemaRules.test.js --testTimeout 60000`
Expected: FAIL — `Cannot find module '../../generate/schemaRules.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// generate/schemaRules.mjs
// Rule primitives for the D22 naturalized schema generator.
// Spec: docs/superpowers/specs/2026-07-03-d22-naturalized-schema-design.md

// VM pattern -> {min, max, multiple, multi}. max null = unbounded.
// multi = the naturalized container is an array (VM other than exactly "1").
export function parseVm(vm) {
    let m;
    if ((m = vm.match(/^(\d+)$/))) {
        const n = Number(m[1]);
        return { min: n, max: n, multiple: null, multi: n !== 1 };
    }
    if ((m = vm.match(/^(\d+)-n$/))) {
        return { min: Number(m[1]), max: null, multiple: null, multi: true };
    }
    if ((m = vm.match(/^(\d+)-(\d+)$/))) {
        return { min: Number(m[1]), max: Number(m[2]), multiple: null, multi: true };
    }
    if ((m = vm.match(/^(\d+)-(\d+)n$/))) {
        // e.g. 3-3n: at least 3, count must be a multiple of 3
        return { min: Number(m[1]), max: null, multiple: Number(m[2]), multi: true };
    }
    throw new Error(`unclassifiable VM pattern: "${vm}"`);
}

const STRING_VRS = ["AE","AS","AT","CS","DA","DT","LO","LT","SH","ST","TM","UC","UI","UR","UT"];
const NUMBER_VRS = ["DS","FL","FD","IS","SL","SS","UL","US"];
const BINARY_VRS = ["OB","OD","OF","OL","OV","OW","UN"];

export const VR_SCALAR = Object.fromEntries([
    ...STRING_VRS.map(vr => [vr, "string"]),
    ...NUMBER_VRS.map(vr => [vr, "number"]),
    ...BINARY_VRS.map(vr => [vr, "BinaryValue"]),
    ["PN", "PersonName"],
    ["SQ", "NaturalizedDataset[]"],
    // 64-bit: out-of-safe-range integers retain string form (D14 / spec §12.4)
    ["UV", "number | string"],
    ["SV", "number | string"]
]);

// Ambiguous dictionary VR codes -> explicit member unions (exhaustive for
// the packed dictionary; the generator fails loudly on anything else).
export const MULTI_VR = {
    xs: ["US", "SS"],
    ox: ["OB", "OW"],
    up: ["UL"],
    lt: ["OW", "US", "SS"]
};

// Part 5 per-VR value-format constraints (VR-format depth, D27 decision 3).
export const VR_FORMATS = {
    AE: { maxLength: 16 },
    AS: { pattern: "^\\d{3}[DWMY]$" },
    CS: { maxLength: 16, pattern: "^[A-Z0-9 _]*$" },
    DA: { pattern: "^\\d{8}$" },
    DS: { maxLength: 16 },
    DT: { maxLength: 26, pattern: "^\\d{4}(\\d{2}(\\d{2}(\\d{2}(\\d{2}(\\d{2}(\\.\\d{1,6})?)?)?)?)?)?([+-]\\d{4})?$" },
    IS: { maxLength: 12, pattern: "^[+-]?\\d+$" },
    LO: { maxLength: 64 },
    LT: { maxLength: 10240 },
    SH: { maxLength: 16 },
    ST: { maxLength: 1024 },
    TM: { pattern: "^\\d{2}(\\d{2}(\\d{2}(\\.\\d{1,6})?)?)?$" },
    UI: { maxLength: 64, pattern: "^[0-9.]+$" }
};

// Group FFFE items are stream structure, not data elements (VR "na").
export const EXCLUDED_TAGS = new Set(["FFFEE000", "FFFEE00D", "FFFEE0DD"]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/schema/schemaRules.test.js --testTimeout 60000`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add generate/schemaRules.mjs test/schema/schemaRules.test.js
git commit -m "feat(schema): VM pattern parser and VR rule primitives (D22 task 1)"
```

---

### Task 2: The catalog generator

**Files:**
- Create: `generate/generate-schema.mjs`
- Create (generated): `src/schema/naturalizedRules.js`
- Modify: `package.json` (add `"generate-schema"` script next to `"generate-dictionary"`)
- Test: `test/schema/naturalizedRules.test.js`

**Interfaces:**
- Consumes: `parseVm`, `VR_SCALAR`, `MULTI_VR`, `VR_FORMATS`, `EXCLUDED_TAGS` from `generate/schemaRules.mjs`; `getAllStandardTagEntries()` from `src/dicom.lookup.js` (returns `[{tag: "(0008,0008)", vr, vm, name}]`, 5165 entries)
- Produces: committed `src/schema/naturalizedRules.js` exporting `naturalizedRules = {version, dictionaryHash, vrFormats, attributes, envelope}`; `attributes` keyed by bare 8-hex uppercase tag, each `{keyword, vr: string|string[], vm}`

- [ ] **Step 1: Write the failing test**

```js
// test/schema/naturalizedRules.test.js
import { naturalizedRules } from "../../src/schema/naturalizedRules.js";
import { parseVm } from "../../generate/schemaRules.mjs";

describe("naturalizedRules catalog", () => {
    test("carries version and dictionary hash", () => {
        expect(naturalizedRules.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(naturalizedRules.dictionaryHash).toMatch(/^[0-9a-f]{16}$/);
    });

    test("covers the full standard dictionary minus structural exclusions", () => {
        // 5165 entries in the packed dictionary, 3 FFFE structural items excluded
        expect(Object.keys(naturalizedRules.attributes).length).toBe(5162);
        expect(naturalizedRules.attributes.FFFEE000).toBeUndefined();
    });

    test("spot-checks known attributes", () => {
        expect(naturalizedRules.attributes["00080008"]).toEqual({
            keyword: "ImageType", vr: "CS", vm: "2-n"
        });
        expect(naturalizedRules.attributes["00100020"]).toEqual({
            keyword: "PatientID", vr: "LO", vm: "1"
        });
        // multi-VR code resolved to an explicit union
        expect(naturalizedRules.attributes["00189810"]).toEqual({
            keyword: "ZeroVelocityPixelValue", vr: ["US", "SS"], vm: "1"
        });
    });

    test("every attribute has a parseable VM and known VR", () => {
        const knownScalar = new Set([
            "AE","AS","AT","CS","DA","DT","LO","LT","SH","ST","TM","UC","UI","UR","UT",
            "DS","FL","FD","IS","SL","SS","UL","US",
            "OB","OD","OF","OL","OV","OW","UN","PN","SQ","UV","SV"
        ]);
        for (const [tag, entry] of Object.entries(naturalizedRules.attributes)) {
            expect(() => parseVm(entry.vm)).not.toThrow();
            const vrs = Array.isArray(entry.vr) ? entry.vr : [entry.vr];
            for (const vr of vrs) {
                if (!knownScalar.has(vr)) {
                    throw new Error(`${tag}: unknown VR ${vr}`);
                }
            }
        }
    });

    test("envelope freezes the decided contract tokens", () => {
        expect(naturalizedRules.envelope).toEqual({
            cardinality: "vm-based",
            personName: "componentObject",
            sequences: "datasetArray",
            privateTags: "creatorGrouped",
            unknownTags: "preserved",
            rawRetention: "inexactOnly",
            bulk: "referenceOrBinary"
        });
    });

    test("vrFormats table is present", () => {
        expect(naturalizedRules.vrFormats.DA).toEqual({ pattern: "^\\d{8}$" });
        expect(naturalizedRules.vrFormats.DS).toEqual({ maxLength: 16 });
    });

    test("committed catalog is fresh and deterministic (CI determinism gate)", async () => {
        // Rebuilding from the live dictionary must reproduce the committed artifact
        // exactly — catches stale artifacts AND nondeterminism in one assertion.
        const { buildCatalog } = await import("../../generate/generate-schema.mjs");
        expect(buildCatalog()).toEqual(naturalizedRules);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/schema/naturalizedRules.test.js --testTimeout 60000`
Expected: FAIL — `Cannot find module '../../src/schema/naturalizedRules.js'`

- [ ] **Step 3: Write the generator**

```js
// generate/generate-schema.mjs
// D22 schema generator — emits the normative rule catalog.
// Usage: node generate/generate-schema.mjs
// Deterministic: sorted keys, no timestamps. Fails loudly on anything
// it cannot classify (no silent skips).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllStandardTagEntries } from "../src/dicom.lookup.js";
import { parseVm, VR_SCALAR, MULTI_VR, VR_FORMATS, EXCLUDED_TAGS } from "./schemaRules.mjs";

const SCHEMA_VERSION = "1.0.0";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function bareTag(paren) {
    // "(0008,0008)" -> "00080008"
    const m = paren.match(/^\((\w{4}),(\w{4})\)$/);
    if (!m) {
        throw new Error(`unexpected tag format: ${paren}`);
    }
    return (m[1] + m[2]).toUpperCase();
}

export function buildCatalog() {
    const entries = getAllStandardTagEntries();
    const attributes = {};
    for (const e of entries) {
        const tag = bareTag(e.tag);
        if (EXCLUDED_TAGS.has(tag)) {
            continue;
        }
        parseVm(e.vm); // throws on unclassifiable VM — loud failure
        let vr;
        if (VR_SCALAR[e.vr]) {
            vr = e.vr;
        } else if (MULTI_VR[e.vr]) {
            vr = MULTI_VR[e.vr];
        } else {
            throw new Error(`${tag} ${e.name}: unmapped VR code "${e.vr}"`);
        }
        attributes[tag] = { keyword: e.name, vr, vm: e.vm };
    }
    const sorted = Object.fromEntries(
        Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b))
    );
    const dictionaryHash = createHash("sha256")
        .update(JSON.stringify(sorted))
        .digest("hex")
        .slice(0, 16);
    return {
        version: SCHEMA_VERSION,
        dictionaryHash,
        vrFormats: VR_FORMATS,
        attributes: sorted,
        envelope: {
            cardinality: "vm-based",     // VM multi -> array, VM 1 -> scalar (D1)
            personName: "componentObject", // {Alphabetic,Ideographic,Phonetic} (D13)
            sequences: "datasetArray",   // SQ -> NaturalizedDataset[]
            privateTags: "creatorGrouped", // '<slot>:<creator>' keys (D2b, spec 12.3)
            unknownTags: "preserved",    // { vr, Value, rawValue } (spec 12.3)
            rawRetention: "inexactOnly", // raw kept when round-trip inexact (D14)
            bulk: "referenceOrBinary"    // {BulkDataURI} | {InlineBinary} | binary
        }
    };
}

export function writeCatalog(catalog) {
    const header =
        "// GENERATED by generate/generate-schema.mjs — DO NOT EDIT.\n" +
        "// Normative rule catalog for the naturalized representation (D22).\n" +
        "// Spec: docs/superpowers/specs/2026-07-03-d22-naturalized-schema-design.md\n";
    const body = `export const naturalizedRules = ${JSON.stringify(catalog, null, 2)};\n`;
    mkdirSync(join(root, "src", "schema"), { recursive: true });
    writeFileSync(join(root, "src", "schema", "naturalizedRules.js"), header + body);
}

// Run when invoked directly (kept import-safe for later projection tasks)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        writeCatalog(buildCatalog());
        console.log("wrote src/schema/naturalizedRules.js");
    } catch (err) {
        console.error(`generate-schema FAILED: ${err.message}`);
        process.exit(1);
    }
}
```

Add to `package.json` scripts (next to `"generate-dictionary"`):

```json
"generate-schema": "node generate/generate-schema.mjs",
```

- [ ] **Step 4: Run the generator, then the test**

Run: `npm run generate-schema && npx jest test/schema/naturalizedRules.test.js --testTimeout 60000`
Expected: `wrote src/schema/naturalizedRules.js`, then PASS.
If the entry-count assertion fails, print the actual count, verify the delta is explained
by `EXCLUDED_TAGS` only, and correct the expected number in the test — the invariant is
"total dictionary entries minus explicit exclusions", not the literal 5162.

- [ ] **Step 5: Determinism check**

Run: `npm run generate-schema && git diff --exit-code src/schema/naturalizedRules.js`
Expected: exit 0 (no diff on second run)

- [ ] **Step 6: Commit (generator + generated artifact)**

```bash
git add generate/generate-schema.mjs src/schema/naturalizedRules.js package.json test/schema/naturalizedRules.test.js
git commit -m "feat(schema): naturalized rule catalog generator + committed catalog (D22 task 2)"
```

---

### Task 3: TypeScript projection + tsc gate

**Files:**
- Modify: `generate/generate-schema.mjs` (add the d.ts emitter)
- Create (generated): `types/dcmjs-schema.d.ts`
- Create: `types/checks/consumer.ts` (hand-written tsc gate file)
- Modify: `package.json` (devDependency `typescript`, script `check:types`)

**Interfaces:**
- Consumes: `buildCatalog()` from task 2; `parseVm`, `VR_SCALAR`, `MULTI_VR` from task 1
- Produces: `types/dcmjs-schema.d.ts` exporting `NaturalizedDataset`, `PersonName`, `BulkDataReference`, `InlineBinaryReference`, `BinaryValue`

- [ ] **Step 1: Install typescript and add the check script**

```bash
pnpm add -D typescript
```

In `package.json` scripts:

```json
"check:types": "tsc --noEmit --strict types/checks/consumer.ts",
```

- [ ] **Step 2: Write the tsc gate file (this is the failing "test")**

```ts
// types/checks/consumer.ts
// tsc gate for the generated D22 types. Compiled by `npm run check:types`;
// never bundled. Positive cases must compile; @ts-expect-error lines must fail.
import type { NaturalizedDataset, PersonName, BinaryValue } from "../dcmjs-schema";

declare const ds: NaturalizedDataset;

// VM 1 -> scalar
const patientId: string | undefined = ds.PatientID;

// VM 2-n -> array even with one value (the contract that kills Array.isArray guards)
const imageType: string[] | undefined = ds.ImageType;
const firstType: string | undefined = ds.ImageType?.[0];

// DS VM 2 -> number[]
const spacing: number[] | undefined = ds.PixelSpacing;

// PN -> component object (D13)
const pn: PersonName | undefined = ds.PatientName;
const alpha: string | undefined = ds.PatientName?.Alphabetic;

// SQ -> dataset array
const shared: NaturalizedDataset[] | undefined = ds.SharedFunctionalGroupsSequence;

// Binary
const pixels: BinaryValue | undefined = ds.PixelData;

// Negative cases — these MUST be type errors:
// @ts-expect-error ImageType is string[], not string (VM 2-n stays a list)
const wrongScalar: string = ds.ImageType;
// @ts-expect-error PatientID is a scalar, not an array (VM 1)
const wrongArray: string[] = ds.PatientID;
// @ts-expect-error PixelSpacing elements are numbers
const wrongElem: string = ds.PixelSpacing![0];

export { patientId, imageType, firstType, spacing, pn, alpha, shared, pixels, wrongScalar, wrongArray, wrongElem };
```

- [ ] **Step 3: Run the gate to verify it fails**

Run: `npm run check:types`
Expected: FAIL — `Cannot find module '../dcmjs-schema'`

- [ ] **Step 4: Add the d.ts emitter to the generator**

Append to `generate/generate-schema.mjs` (and call it from the direct-run block, after `writeCatalog`):

```js
export function tsTypeFor(entry) {
    const vrs = Array.isArray(entry.vr) ? entry.vr : [entry.vr];
    const scalars = [...new Set(vrs.map(vr => VR_SCALAR[vr]))];
    const scalar = scalars.join(" | ");
    if (scalar === "NaturalizedDataset[]") {
        return scalar; // sequences are arrays regardless of VM
    }
    const { multi } = parseVm(entry.vm);
    if (!multi) {
        return scalar;
    }
    return scalars.length > 1 ? `(${scalar})[]` : `${scalar}[]`;
}

export function writeTypes(catalog) {
    const lines = [
        "// GENERATED by generate/generate-schema.mjs — DO NOT EDIT.",
        `// Schema version ${catalog.version} (dictionary ${catalog.dictionaryHash}).`,
        "// Naturalized data shape ONLY — this is not a full dcmjs API typing.",
        "",
        "export interface PersonName {",
        "    Alphabetic?: string;",
        "    Ideographic?: string;",
        "    Phonetic?: string;",
        "}",
        "export type BulkDataReference = { BulkDataURI: string };",
        "export type InlineBinaryReference = { InlineBinary: string };",
        "export type BinaryValue = ArrayBuffer | BulkDataReference | InlineBinaryReference;",
        "",
        "export interface NaturalizedDataset {"
    ];
    for (const [tag, entry] of Object.entries(catalog.attributes)) {
        lines.push(`    /** ${tag} · VR ${Array.isArray(entry.vr) ? entry.vr.join("/") : entry.vr} · VM ${entry.vm} */`);
        lines.push(`    ${entry.keyword}?: ${tsTypeFor(entry)};`);
    }
    lines.push("    /** Private ('<slot>:<creator>') and unknown-tag keys (spec 12.3) */");
    lines.push("    [privateOrUnknown: string]: unknown;");
    lines.push("}");
    lines.push("");
    mkdirSync(join(root, "types"), { recursive: true });
    writeFileSync(join(root, "types", "dcmjs-schema.d.ts"), lines.join("\n"));
}
```

Note: duplicate keywords exist in the dictionary (retired vs current tags can share
names). The emitter must deduplicate: keep the first occurrence per keyword, and when a
duplicate's computed TS type differs, widen to a union of both types with a comment
listing both tags. Implement as a `seen` Map keyed by keyword inside `writeTypes`.

- [ ] **Step 5: Regenerate and run both gates**

Run: `npm run generate-schema && npm run check:types && npx jest test/schema/ --testTimeout 60000`
Expected: all PASS. If tsc reports duplicate identifiers, the dedup in step 4's note is missing/wrong.

- [ ] **Step 6: Commit**

```bash
git add generate/generate-schema.mjs types/dcmjs-schema.d.ts types/checks/consumer.ts package.json pnpm-lock.yaml
git commit -m "feat(schema): generated TypeScript projection + tsc gate (D22 task 3)"
```

---

### Task 4: JSON-Schema projection

**Files:**
- Modify: `generate/generate-schema.mjs` (add the JSON-Schema emitter)
- Create (generated): `schema/naturalized.schema.json`
- Test: `test/schema/jsonSchemaProjection.test.js`

**Interfaces:**
- Consumes: `buildCatalog()`, `parseVm`, `VR_SCALAR`, `MULTI_VR`
- Produces: `schema/naturalized.schema.json` — JSON Schema draft 2020-12, one `properties` entry per keyword, `x-dicom-vr`/`x-dicom-vm` annotations

- [ ] **Step 1: Write the failing test**

```js
// test/schema/jsonSchemaProjection.test.js
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = JSON.parse(
    readFileSync(join(__dirname, "../../schema/naturalized.schema.json"), "utf8")
);

describe("JSON-Schema projection", () => {
    test("declares draft 2020-12 and the catalog version", () => {
        expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
        expect(schema["x-dicom-schema-version"]).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("VM 2-n attribute is an array with minItems", () => {
        expect(schema.properties.ImageType).toEqual({
            type: "array",
            items: { type: "string" },
            minItems: 2,
            "x-dicom-vr": "CS",
            "x-dicom-vm": "2-n",
            "x-dicom-tag": "00080008"
        });
    });

    test("VM 1 attribute is a scalar with VR format constraints inlined", () => {
        expect(schema.properties.StudyDate).toEqual({
            type: "string",
            pattern: "^\\d{8}$",
            "x-dicom-vr": "DA",
            "x-dicom-vm": "1",
            "x-dicom-tag": "00080020"
        });
    });

    test("sequences reference the dataset schema recursively", () => {
        expect(schema.properties.SharedFunctionalGroupsSequence).toEqual({
            type: "array",
            items: { $ref: "#" },
            "x-dicom-vr": "SQ",
            "x-dicom-vm": "1",
            "x-dicom-tag": "52009229"
        });
    });

    test("additionalProperties stays open for private/unknown keys", () => {
        expect(schema.additionalProperties).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/schema/jsonSchemaProjection.test.js --testTimeout 60000`
Expected: FAIL — ENOENT `schema/naturalized.schema.json`

- [ ] **Step 3: Add the emitter**

Append to `generate/generate-schema.mjs` (call from the direct-run block):

```js
export function jsonSchemaFor(entry, catalog) {
    const vrs = Array.isArray(entry.vr) ? entry.vr : [entry.vr];
    const scalarTs = [...new Set(vrs.map(vr => VR_SCALAR[vr]))];
    let item;
    if (scalarTs.length === 1 && scalarTs[0] === "NaturalizedDataset[]") {
        item = { $ref: "#" };
    } else if (scalarTs.length === 1 && scalarTs[0] === "string") {
        item = { type: "string" };
        const fmt = vrs.length === 1 ? catalog.vrFormats[vrs[0]] : undefined;
        if (fmt?.pattern) item.pattern = fmt.pattern;
        if (fmt?.maxLength) item.maxLength = fmt.maxLength;
    } else if (scalarTs.length === 1 && scalarTs[0] === "number") {
        item = { type: "number" };
    } else {
        item = {}; // PersonName, BinaryValue, unions: annotation-only
    }
    const vm = parseVm(entry.vm);
    const isSq = scalarTs[0] === "NaturalizedDataset[]";
    let prop;
    if (isSq || vm.multi) {
        prop = { type: "array", items: item };
        if (!isSq && vm.min > 1) prop.minItems = vm.min;
        if (!isSq && vm.max !== null && vm.max !== vm.min) prop.maxItems = vm.max;
    } else {
        prop = { ...item };
        if (!prop.type && scalarTs[0] === "number") prop.type = "number";
    }
    prop["x-dicom-vr"] = Array.isArray(entry.vr) ? entry.vr.join("/") : entry.vr;
    prop["x-dicom-vm"] = entry.vm;
    return prop;
}

export function writeJsonSchema(catalog) {
    const properties = {};
    const seen = new Set();
    for (const [tag, entry] of Object.entries(catalog.attributes)) {
        if (seen.has(entry.keyword)) continue; // keep first per keyword, as in the d.ts
        seen.add(entry.keyword);
        properties[entry.keyword] = { ...jsonSchemaFor(entry, catalog), "x-dicom-tag": tag };
    }
    const doc = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://dcmjs.org/schema/naturalized.schema.json",
        title: "dcmjs naturalized dataset",
        "x-dicom-schema-version": catalog.version,
        "x-dicom-dictionary-hash": catalog.dictionaryHash,
        type: "object",
        properties,
        additionalProperties: true
    };
    mkdirSync(join(root, "schema"), { recursive: true });
    writeFileSync(
        join(root, "schema", "naturalized.schema.json"),
        JSON.stringify(doc, null, 2) + "\n"
    );
}
```

- [ ] **Step 4: Regenerate and test**

Run: `npm run generate-schema && npx jest test/schema/ --testTimeout 60000 && npm run check:types`
Expected: PASS. Adjust the test's expected objects only if the actual emission is *more*
correct (e.g. StudyDate VM is "1" — confirm against the catalog, not from memory).

- [ ] **Step 5: Commit**

```bash
git add generate/generate-schema.mjs schema/naturalized.schema.json test/schema/jsonSchemaProjection.test.js
git commit -m "feat(schema): JSON-Schema 2020-12 projection (D22 task 4)"
```

---

### Task 5: Code-agreement gate — catalog vs NaturalizedListener over the corpus

**Files:**
- Test: `test/schema/codeAgreement.test.js`

**Interfaces:**
- Consumes: `naturalizedRules` catalog; the public event-stream API. Crib fixture
  discovery and naturalization from `test/eventStream/NaturalizedListener.test.js`
  (it has the FIXTURES list + naturalize helper patterns) — reuse its approach
  verbatim rather than inventing a new one.

- [ ] **Step 1: Read the existing test helper pattern**

Run: `sed -n '1,60p' test/eventStream/NaturalizedListener.test.js`
Note the fixture discovery (FIXTURES / PARSER_IMAGES_DIR) and how a buffer becomes a
naturalized object (the `naturalizeFrom()` helper or `DicomEventStream.fromPart10(...)`).
Use the same imports and helper style in the new test.

- [ ] **Step 2: Write the gate test**

```js
// test/schema/codeAgreement.test.js
// D22 code-agreement gate: everything NaturalizedListener produces across the
// corpus must satisfy the catalog's shape rules. Schema-says-X-code-does-Y
// fails in either direction (for produced keys).
// NOTE: adapt the two imports marked CRIB to match NaturalizedListener.test.js exactly.
import { naturalizedRules } from "../../src/schema/naturalizedRules.js";
import { parseVm } from "../../generate/schemaRules.mjs";
// CRIB: fixture discovery + naturalize helper from test/eventStream/NaturalizedListener.test.js
import { FIXTURES, naturalizeFrom } from "./helpers-from-naturalized-listener-test";

const byKeyword = new Map(
    Object.entries(naturalizedRules.attributes).map(([tag, e]) => [e.keyword, { tag, ...e }])
);

const PRIVATE_KEY = /^[0-9A-Fa-f]{4}:/;      // '<slot>:<creator>' grouping (D2b)
const UNKNOWN_KEY = /^[0-9A-Fa-f]{8}$/;      // preserved unknown tags (spec 12.3)

function checkDataset(ds, path, problems) {
    for (const [key, value] of Object.entries(ds)) {
        if (value === undefined || value === null) continue;
        if (key.startsWith("_")) continue;                    // internal metadata
        if (PRIVATE_KEY.test(key) || UNKNOWN_KEY.test(key)) continue;
        const rule = byKeyword.get(key);
        if (!rule) {
            problems.push(`${path}.${key}: key not in catalog`);
            continue;
        }
        const vrs = Array.isArray(rule.vr) ? rule.vr : [rule.vr];
        if (vrs.includes("SQ")) {
            if (!Array.isArray(value)) {
                problems.push(`${path}.${key}: SQ must be an array (got ${typeof value})`);
            } else {
                value.forEach((item, i) => checkDataset(item, `${path}.${key}[${i}]`, problems));
            }
            continue;
        }
        const { multi } = parseVm(rule.vm);
        if (multi && !Array.isArray(value)) {
            problems.push(`${path}.${key}: VM ${rule.vm} must be an array (got ${typeof value})`);
        }
        if (!multi && Array.isArray(value)) {
            problems.push(`${path}.${key}: VM 1 must be a scalar (got array)`);
        }
    }
}

describe("D22 code-agreement gate", () => {
    test.each(FIXTURES)("catalog agrees with NaturalizedListener on %s", async fixture => {
        const ds = await naturalizeFrom(fixture);
        const problems = [];
        checkDataset(ds, "$", problems);
        expect(problems).toEqual([]);
    });
});
```

- [ ] **Step 3: Run the gate**

Run: `npx jest test/schema/codeAgreement.test.js --testTimeout 60000`
Expected: PASS. **If it fails, do not immediately edit the test.** Each failure is either
(a) a catalog bug (fix generator/rules), (b) a NaturalizedListener bug (a real D22 payoff —
record it, fix if in scope, or add to a documented known-violations list with an issue
reference), or (c) a legitimate envelope case the checker misclassifies (e.g. PN objects,
binary values, cardinality-policy artifacts) — extend the checker for it. Classify every
failure explicitly in the commit message.

- [ ] **Step 4: Run the full suite on both cores (regression safety)**

Run: `pnpm test && DCMJS_CORE=eager pnpm test`
Expected: all green (existing count + new schema tests).

- [ ] **Step 5: Commit**

```bash
git add test/schema/codeAgreement.test.js
git commit -m "test(schema): code-agreement gate — catalog vs NaturalizedListener corpus (D22 task 5)"
```

---

### Task 6: Subpath export + docs guide

**Files:**
- Modify: `package.json` (exports map — follow the existing `./dictionary` entry's pattern)
- Create: `packages/docs/docs/guides/schema.md`
- Test: `test/schema/exports.test.js`

- [ ] **Step 1: Write the failing export test**

```js
// test/schema/exports.test.js
describe("dcmjs/schema subpath", () => {
    test("package.json maps ./schema with runtime and types", () => {
        const pkg = require("../../package.json");
        expect(pkg.exports["./schema"]).toEqual({
            types: "./types/dcmjs-schema.d.ts",
            import: "./src/schema/naturalizedRules.js"
        });
    });
});
```

- [ ] **Step 2: Run to verify it fails, then add the export**

Run: `npx jest test/schema/exports.test.js --testTimeout 60000` → FAIL.
Open `package.json`, find the existing `exports` map (it already has a `./dictionary`
entry), and add — matching the existing entry's key order and any `require` condition the
`./dictionary` entry carries (if `./dictionary` also has `require`, mirror the pattern;
update the test to match what you actually ship):

```json
"./schema": {
    "types": "./types/dcmjs-schema.d.ts",
    "import": "./src/schema/naturalizedRules.js"
}
```

Re-run → PASS.

- [ ] **Step 3: Write the docs guide**

Create `packages/docs/docs/guides/schema.md` with exactly these sections (content drawn
from the spec — this is the public API documentation):

```markdown
# The Naturalized Schema (`dcmjs/schema`)

One machine-readable source of truth for the naturalized representation,
with three projections. The catalog is normative; the TypeScript types and
the JSON-Schema document are generated from it and cannot drift.

## Quick start

    import { naturalizedRules } from "dcmjs/schema";
    import type { NaturalizedDataset } from "dcmjs/schema";

    const ds: NaturalizedDataset = await DicomEventStream.from(bytes).toNaturalized();
    ds.ImageType?.[0];     // string — VM 2-n is ALWAYS an array
    ds.PatientID;          // string | undefined — VM 1 is always a scalar

## The rule catalog

[Document: version + dictionaryHash; vrFormats table with 3 examples;
attributes entry shape {keyword, vr, vm} incl. multi-VR unions;
the envelope tokens and what each freezes — cardinality: "vm-based",
personName: "componentObject", sequences: "datasetArray",
privateTags: "creatorGrouped", unknownTags: "preserved",
rawRetention: "inexactOnly", bulk: "referenceOrBinary".]

## The TypeScript projection

[Document: NaturalizedDataset (flat, all-optional, VM-correct types),
PersonName, BulkDataReference, InlineBinaryReference, BinaryValue;
the honest non-claim — this types the naturalized data shape, not the
whole dcmjs API.]

## The JSON-Schema projection

[Document: draft 2020-12, x-dicom-* annotations, ajv usage example,
and that it is a projection for ecosystem tooling — streaming
validation (slice H) consumes the catalog directly.]

## Regeneration

    npm run generate-schema

[Document: committed artifacts, determinism, the three CI gates.]
```

The bracketed blocks are section content the implementer writes from the spec
(`docs/superpowers/specs/2026-07-03-d22-naturalized-schema-design.md`) — every named item
listed in the brackets must appear in the finished page.

- [ ] **Step 4: Full suite + commit**

```bash
pnpm test
git add package.json test/schema/exports.test.js packages/docs/docs/guides/schema.md
git commit -m "feat(schema): dcmjs/schema subpath export + API guide (D22 task 6)"
```

---

### Task 7: Land on PR #2 with API documentation

**Files:** none (git/GitHub operations)

- [ ] **Step 1: Final verification**

Run: `npm run generate-schema && git diff --exit-code && pnpm test && DCMJS_CORE=eager pnpm test && npm run check:types`
Expected: no regenerate diff, both suites green, types clean. Do not proceed on any failure.

- [ ] **Step 2: Push the schema branch and fast-forward the PR branch**

```bash
git push -u awatson1978 dcmjs-unified-schema
# PR #2's head is dcmjs-unified-comments; dcmjs-unified-schema builds directly on it,
# so this is a fast-forward:
git push awatson1978 dcmjs-unified-schema:dcmjs-unified-comments
```

- [ ] **Step 3: Update PR #2 with the API documentation (user requirement)**

Update the PR body (append a "## D22: `dcmjs/schema` — implemented API" section) via
`gh pr edit 2 --repo awatson1978/dcmjs --body-file <file>`, and post a PR comment via
`gh pr comment 2 --repo awatson1978/dcmjs --body-file <file>` documenting:
- The public API surface: the `dcmjs/schema` subpath, `naturalizedRules` export
  (version, dictionaryHash, vrFormats, attributes, envelope), and the exported types
  (`NaturalizedDataset`, `PersonName`, `BulkDataReference`, `InlineBinaryReference`,
  `BinaryValue`)
- The one-truth/three-projections model and which artifact is normative
- The three CI gates and what each guarantees
- Worked consumer examples (TS import; ajv against the JSON-Schema projection)
- Anything the code-agreement gate surfaced (known-violations list, if any)
