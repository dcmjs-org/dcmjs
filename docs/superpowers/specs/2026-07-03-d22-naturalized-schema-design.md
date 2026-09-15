# D22 — Machine-Readable Schema for the Naturalized Representation

**Date:** 2026-07-03 · **Branch:** `dcmjs-unified-schema` · **Status:** approved design
**Decision-log context:** D22 (Review Round 1), scope confirmed in D26; schema-subject
decision recorded as D27 in `CLAUDE_REFACTOR_ANALYSIS.md`.

## Purpose

Complement the prose Naturalized spec (component 1) with a machine-readable definition of
the naturalized representation. It is the definition of "supported" in 1.0 (Steve Pieper,
Review Round 1), the input to slice H's conformance validator, and dcmjs's first published
TypeScript types. One source of truth; three projections; nothing can drift.

## Decisions (with options considered)

### 1. TS type granularity — **one flat interface**

Options: (a) one flat generated `NaturalizedDataset` interface, every standard keyword an
optional property with its VM-correct type; (b) flat interface + per-VR branded types;
(c) IOD-aware per-SOP-class interfaces.

**Selected: (a).** The packed dictionary supplies attribute-level VR/VM for 5,165 entries
but contains no IOD composition (Part 3); (c) is a separate acquisition project and can
layer on later. (b) fights plain-object semantics for little consumer gain.

### 2. Schema subject — **rule catalog as source of truth** (D27)

Options considered:

- **(A) Rule catalog as source of truth — SELECTED.** The primary artifact is a
  machine-readable rule catalog (tag → VR, VM pattern; shared per-VR format table)
  generated from the packed dictionary. The TS `.d.ts` and a literal JSON-Schema document
  are *derived projections*. Slice H's validator consumes the catalog directly, streaming.
- **(B) Literal JSON Schema primary**, TS types derived via tooling; H interprets the JSON
  Schema. Rejected: JSON Schema cannot natively express DICOM VM patterns (`3-3n`) or VR
  length caps in original encoding, needs custom keywords anyway, and is built to validate
  a materialized document — slice H validates element-by-element over the event stream.
- **(C) Two independent artifacts** generated separately from the dictionary. Rejected:
  two encodings of the same rules is precisely the drift D22 exists to prevent.

**Rationale for (A):** one normative encoding; every consumer (types, ecosystem JSON-Schema
tooling, the streaming validator) is a projection or reader of it, so agreement is by
construction — the same argument as the event-stream hub model.

### 3. Rule depth — **VR-format depth**

Options: structural only (VR + VM + shape); VR-format depth (adds per-VR Part 5 value
constraints — DA/TM/DT patterns, IS ≤ 12 / DS ≤ 16 caps, UI charset, AS format, max
lengths); defined-terms depth (adds per-attribute enumerated values).

**Selected: VR-format depth.** ~30 VRs, hand-encoded once, static; this is what makes
slice H's warnings substantive. Defined terms require Part 3/16 acquisition — out of scope.

### 4. Distribution — **subpath exports**

Options: `dcmjs/schema` subpath export; top-level `"types"` field; repo-only artifacts.

**Selected: subpath.** A top-level `types` field would falsely imply the whole API is
typed and can collide with consumers' hand-written `declare module 'dcmjs'` blocks
(dicom-curate maintains one). The subpath is an honest opt-in:
`import type { NaturalizedDataset } from "dcmjs/schema"`.

## Architecture

```
generate/generate-schema.mjs           generator (follows pack_dicom.mjs conventions)
        │  reads getAllStandardTagEntries() (5,165 entries: {tag, vr, vm, name})
        ▼
src/schema/naturalizedRules.js         THE CATALOG — committed ES module, normative
        ├──→ types/dcmjs-schema.d.ts           TS projection (committed)
        └──→ schema/naturalized.schema.json    JSON-Schema 2020-12 projection (committed)
```

Artifacts are generated **and committed** (repo convention: `dicom.packed.js` is committed
output of `generate/`). Regeneration happens on dictionary change; CI runs the generator
and requires a clean `git diff` (determinism gate).

`package.json` gains:

```json
"exports": {
  "./schema": {
    "types": "./types/dcmjs-schema.d.ts",
    "import": "./src/schema/naturalizedRules.js"
  }
}
```

(Exact paths may be adjusted to the build pipeline during implementation; the contract is
the subpath name `dcmjs/schema` and the pairing of runtime catalog + types.)

## The catalog format (normative)

```js
export const naturalizedRules = {
  version: "1.0.0",            // schema semver; carries the dictionary edition stamp
  vrFormats: {                 // shared per-VR Part 5 constraints (~30 entries, hand-encoded)
    DA: { pattern: "^\\d{8}$" },
    TM: { pattern: "^\\d{2}(\\d{2}(\\d{2}(\\.\\d{1,6})?)?)?$" },
    IS: { maxLength: 12, pattern: "^[+-]?\\d+$" },
    DS: { maxLength: 16 },
    UI: { maxLength: 64, pattern: "^[0-9.]+$" },
    AS: { pattern: "^\\d{3}[DWMY]$" }
    // … one entry per VR that has a Part 5 format/length constraint
  },
  attributes: {                // one entry per standard attribute, keyed by 8-hex tag
    "00080008": { keyword: "ImageType", vr: "CS", vm: "2-n" },
    "00100010": { keyword: "PatientName", vr: "PN", vm: "1" }
    // … 5,165 entries
  },
  envelope: {                  // machine-readable encoding of the non-per-attribute rules
    // These freeze existing decisions into the public contract:
    cardinality: "vm-based",         // VM multi → array, VM 1 → scalar; never count-based (D1)
    personName: "componentObject",   // {Alphabetic, Ideographic, Phonetic} + toString/toJSON (D13)
    sequences: "datasetArray",       // SQ → NaturalizedDataset[]
    privateTags: "creatorGrouped",   // '<slot>:<creator>' keys, values always lists (D2b, §12.3)
    unknownTags: "preserved",        // { vr, Value, rawValue } (§12.3)
    rawRetention: "inexactOnly",     // raw kept when round-trip is inexact (D14)
    bulk: "referenceOrBinary"        // { BulkDataURI } | { InlineBinary } | binary
  }
};
```

Notes:

- **Multi-VR codes** (`xs`, `ox`, `up`, `lt`, `na` — present in the packed dictionary) are
  kept as explicit VR unions; shape is the union of member shapes; the validator treats
  them as one-of.
- **VM patterns**: all 19 distinct patterns observed in the dictionary (`1`, `2`, `3`,
  `1-n`, `2-n`, `3-3n`, `1-32`, `6-n`, …) parse into `{min, max, multiple}` form in the
  generator. The generator **fails loudly** on any VR or VM it cannot classify — no silent
  skips; genuine oddballs go in an explicit, reviewed exceptions table in the generator.
- The `envelope` values are machine-readable enum tokens; their semantics are specified in
  the prose spec and mirrored in the docs page. Slice H's validator switches on them.

## TS projection

One generated interface; all properties optional (presence is IOD knowledge we don't have):

```ts
export interface NaturalizedDataset {
  PatientID?: string;                              // LO, VM 1
  ImageType?: string[];                            // CS, VM 2-n
  PixelSpacing?: number[];                         // DS, VM 2
  PatientName?: PersonName;                        // PN, VM 1 (D13 shape)
  SharedFunctionalGroupsSequence?: NaturalizedDataset[];   // SQ
  PixelData?: BinaryValue;                         // OW/OB
  [privateOrUnknown: string]: unknown;             // §12.3 envelope
}
export interface PersonName { Alphabetic?: string; Ideographic?: string; Phonetic?: string; }
export type BulkDataReference = { BulkDataURI: string };
export type InlineBinaryReference = { InlineBinary: string };
export type BinaryValue = ArrayBuffer | BulkDataReference | InlineBinaryReference;
```

VR → scalar map: string VRs (`CS LO SH ST LT UT UC UR UI AE AS DA TM DT AT`) → `string`;
numeric VRs (`DS IS FL FD SL SS UL US`) → `number`; `PN` → `PersonName`;
`SQ` → `NaturalizedDataset[]`; binary byte VRs (`OB OW OF OD OL OV UN`) → `BinaryValue`
(per D9: these decode to byte blobs, not per-value numbers);
`UV`/`SV` (64-bit) → `number | string` (out-of-range integers retain string form, per D14
and the §12.4 resolution — no BigInt, it doesn't survive `JSON.stringify`/`structuredClone`).
Multi-VR union codes → TS unions. VM multi lifts the scalar to `T[]`.

## JSON-Schema projection

Draft 2020-12. One `properties` entry per keyword; array-vs-scalar and `minItems` where JSON
Schema can express the VM; `x-dicom-vr` / `x-dicom-vm` annotations where it can't. Shipped
for ecosystem tooling (ajv-style whole-object validation). **Documented as a projection:**
the catalog is normative; slice H consumes the catalog, not this file.

## Testing / drift protection

1. **Code-agreement gate** (critical): run `NaturalizedListener` over the full fixture
   corpus (`discoverFixtures` over `packages/parser/testImages/` + `test/`); every produced
   key and value shape must satisfy the catalog. Schema-says-X-code-does-Y fails CI in
   either direction. This gate is also the seed of slice H's validator core.
2. **tsc gate**: a checked consumer file compiles against the generated `.d.ts`, with
   positive cases and `@ts-expect-error` negatives (e.g. `ds.ImageType` used as a scalar).
3. **Determinism gate**: CI regenerates all three artifacts; `git diff --exit-code`.
4. **Version policy**: catalog version bumps with dictionary regeneration; all three
   artifacts carry the same stamp; the equivalence suite pins the version it validated.

## Documentation deliverables

- Docs page `packages/docs/docs/guides/schema.md`: the `dcmjs/schema` API — catalog format,
  exported types, JSON-Schema projection, worked consumer examples (OHIF-style
  `import type { NaturalizedDataset }`, an ajv example against the JSON-Schema projection).
- **The PR description documents the public API surface** (exports, entry points, catalog
  shape, the one-truth/three-projections model), not just a change summary. (User
  requirement, 2026-07-03.)

## Out of scope (explicit)

- IOD-aware / per-SOP-class types (needs Part 3 module tables — separate project)
- Defined-terms / enumerated-value validation (needs Part 3/16)
- Full-API `.d.ts` for dcmjs (only the naturalized data shape is typed)
- Packing/compressing the catalog (revisit only if bundle size becomes a measured problem)
- The slice H validator itself (separate planning cycle; this delivers its input)
