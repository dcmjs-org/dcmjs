# The Naturalized Schema (`dcmjs/schema`)

One machine-readable source of truth for the naturalized representation, with
three projections. The **rule catalog is normative**; the TypeScript types and
the JSON-Schema document are generated from it and cannot drift.

```
generate/generate-schema.mjs                (the generator)
        │
        ▼
src/schema/naturalizedRules.js              THE CATALOG (normative)
        ├──→ types/dcmjs-schema.d.ts        TypeScript projection
        └──→ schema/naturalized.schema.json JSON-Schema 2020-12 projection
```

## Quick start

```ts
import { naturalizedRules } from "dcmjs/schema";
import type { NaturalizedDataset } from "dcmjs/schema";

const ds: NaturalizedDataset = await DicomEventStream.from(bytes).toNaturalized();

ds.ImageType?.[0]; // string — VM 2-n is ALWAYS an array, even with one value
ds.PatientID;      // string | undefined — VM 1 is always a scalar
```

The shape of every attribute is a documented function of its VR and VM — the
same in every instance from every source. This is the contract that replaces
defensive `Array.isArray(...)` guards.

## The rule catalog

`naturalizedRules` has five parts:

| Field | Meaning |
|---|---|
| `version` | Schema semver (`"1.0.0"`). Bumps when the rules change. |
| `dictionaryHash` | 16-hex stamp of the attribute table — ties the artifact to the exact dictionary edition it was generated from. |
| `vrFormats` | Per-VR value-format constraints from PS3.5. |
| `attributes` | One entry per standard attribute, keyed by 8-hex tag. |
| `envelope` | The rules that are not per-attribute (see below). |

### `attributes`

```js
naturalizedRules.attributes["00080008"]
// { keyword: "ImageType", vr: "CS", vm: "2-n" }

naturalizedRules.attributes["00189810"]
// { keyword: "ZeroVelocityPixelValue", vr: ["US", "SS"], vm: "1" }
//   ^ ambiguous dictionary VRs are explicit unions, never a made-up code
```

### `vrFormats`

Value-format constraints usable by any validator:

```js
naturalizedRules.vrFormats.DA  // { pattern: "^\\d{8}$" }
naturalizedRules.vrFormats.IS  // { maxLength: 12, pattern: "^[+-]?\\d+$" }
naturalizedRules.vrFormats.DS  // { maxLength: 16 }
```

### `envelope`

Machine-readable tokens freezing the cross-cutting naturalization contract:

| Token | Value | Freezes |
|---|---|---|
| `cardinality` | `"vm-based"` | VM multi → array, VM 1 → scalar — never dependent on the runtime value count |
| `personName` | `"componentObject"` | PN values are `{Alphabetic, Ideographic, Phonetic}` objects |
| `sequences` | `"datasetArray"` | SQ values are arrays of naturalized datasets |
| `privateTags` | `"creatorGrouped"` | private values are grouped under `"<slot>:<creator>"` keys |
| `unknownTags` | `"preserved"` | unknown tags keep `{ vr, Value, rawValue }` |
| `rawRetention` | `"inexactOnly"` | raw source strings retained when numeric round-trip is inexact |
| `bulk` | `"referenceOrBinary"` | large values are `{BulkDataURI}` / `{InlineBinary}` refs or binary |

## The TypeScript projection

`types/dcmjs-schema.d.ts` exports:

- **`NaturalizedDataset`** — one flat interface, every standard keyword as an
  optional property with its VM-correct type (`PatientID?: string`,
  `ImageType?: string[]`, `PixelSpacing?: number[]`,
  `SharedFunctionalGroupsSequence?: NaturalizedDataset[]`), plus an index
  signature for private/unknown keys.
- **`PersonName`** — `{Alphabetic?, Ideographic?, Phonetic?}`.
- **`BulkDataReference`** / **`InlineBinaryReference`** / **`BinaryValue`** —
  binary VR values (`ArrayBuffer | BulkDataReference | InlineBinaryReference`).

64-bit integers (`UV`/`SV`) type as `number | string`: out-of-safe-range
values retain their original string form so precision is never silently lost.

**Honest non-claim:** this types the naturalized *data shape* only. It is not
a typing of the dcmjs API — that is why it ships as the `dcmjs/schema`
subpath, not a top-level `types` field.

## The JSON-Schema projection

`schema/naturalized.schema.json` is JSON Schema draft 2020-12. VM constraints
appear as `type: "array"` / `minItems` / `maxItems` where JSON Schema can
express them, and as `x-dicom-vr` / `x-dicom-vm` / `x-dicom-tag` annotations
where it cannot. Use it with ecosystem tools:

```js
import Ajv from "ajv/dist/2020";
import schema from "dcmjs/schema/naturalized.schema.json" assert { type: "json" };

const validate = new Ajv({ strict: false }).compile(schema);
validate(naturalizedDataset); // whole-object validation
```

It is a **projection for ecosystem tooling**. Streaming, element-by-element
validation (the planned conformance validator) consumes the catalog directly —
JSON Schema cannot express DICOM VM patterns like `3-3n` or original-encoding
length caps.

## Regeneration and gates

```bash
npm run generate-schema   # rewrites all three artifacts, deterministically
npm run check:types       # tsc gate over types/checks/consumer.ts
npx jest test/schema/     # catalog, projections, code-agreement gates
```

All three artifacts are generated **and committed**. CI enforces:

1. **Freshness/determinism** — rebuilding from the live dictionary must
   reproduce the committed catalog exactly.
2. **Type correctness** — a consumer file compiles against the generated
   `.d.ts`, with `@ts-expect-error` negative cases.
3. **Code agreement** — `NaturalizedListener` output across the full fixture
   corpus must satisfy the catalog's shape rules; a mismatch in either
   direction fails.
