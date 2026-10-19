# @dcmjs-org/schemas

The rules of the naturalized representation — the plain-JavaScript view of
a DICOM dataset that `DicomMetaDictionary.naturalizeDataset` returns —
published three ways: as a runtime rules module, as a JSON Schema, and as
TypeScript declarations.

## What this package is for

dcmjs turns a parsed dataset into natural JavaScript: `dataset.PatientID`
instead of raw tag numbers. The *shape* of that view follows rules — which
keyword a tag maps to, whether a value is a scalar or a list, what a
sequence or a person name or pixel data looks like, and when a value is
null. Those rules used to live implicitly in parser code. This package
states them explicitly, for three consumers:

- **validators** (any JSON Schema tool) use `schema/naturalized.schema.json`
  to check that an object has the naturalized shape;
- **editors and TypeScript builds** use `types/dcmjs-schema.d.ts` for
  the `NaturalizedDataset` property types;
- **runtime code** (a validator UI, an anonymizer checking its tag list, a
  form generator) imports the rules module to look up one attribute's rule.

## How this differs from the dictionary dcmjs already has

It is not a copy of the dictionary. The per-attribute rules **derive on
demand** from the packed dictionary that `@dcmjs-org/core` already ships —
through the same `isMultiVM` rule the runtime uses, so the schema and the
runtime cannot drift apart. What this package adds is the *semantics* on
top of the raw `{tag, vr, vm}` table:

- the naturalized cardinality (`multi`: scalar vs list) per attribute,
- the resolution of ambiguous dictionary VR codes (`xs`, `ox`, `up`, `lt`)
  into explicit VR unions,
- the contract decisions frozen in the `envelope` block (see below),
- the Part 5 value formats (`vrFormats`) as reference documentation,
- and the two static projections (JSON Schema, `.d.ts`) that ajv and tsc
  need as files.

The package lives in this repository because the rules must change in the
same commit as the runtime behavior they describe — CI regenerates the
projections and fails when they drift. A consumer does not regenerate
anything: the two artifacts are committed, and the rules module computes
from the dictionary at require-time (about 5k rules, built once, cached).

## The value contract (`envelope`)

`envelope.values: "asReturned"` — the schema describes **what dcmjs
returns**, not what Part 5 permits. Concretely: a present-but-empty
element is `null` (every property type carries null), list entries can be
null, an empty date string or a malformed age passes through unchanged,
and `vrFormats` documents the Part 5 formats without enforcing them. A
separate Part 5 conformance check can use `vrFormats` to report them.

Other tokens: sequences are a dataset array or the single item itself
(`datasetArrayOrItem` — a one-item sequence naturalizes as the item, with
a hidden `[0]`, `length`, and iterator); binary values are a frame list or
one bulk reference (`{BulkDataURI}` / `{InlineBinary}`); person names are
component objects (`{Alphabetic, Ideographic, Phonetic}`). UV and SV
values are `bigint` — note `JSON.stringify` throws on bigint.

## Which artifact for which task

| Task | Artifact |
| --- | --- |
| Validate a naturalized dataset | `schema/naturalized.schema.json` with ajv |
| Type a dataset in TypeScript | `types/dcmjs-schema.d.ts` (`NaturalizedDataset`) |
| Look up one attribute's rule at runtime | `getAttributeRule(tag)` from the module |
| Check a keyword list / walk a dataset | `buildAttributeRules()` from the module |
| Cite a contract decision | `envelope` from the module |
| Report Part 5 format violations | `vrFormats` from the module |

## Usage

Validate a naturalized dataset (what `test/schema/naturalizedValidation.test.js`
does):

```js
import { readFileSync } from "fs";
import Ajv2020 from "ajv/dist/2020";
import dcmjs from "dcmjs";

const schema = JSON.parse(
    readFileSync("packages/schemas/schema/naturalized.schema.json", "utf8")
);
// strictSchema off: the schema carries x-dicom-* annotation keywords
const validate = new Ajv2020({ strictSchema: false }).compile(schema);

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;
const dataset = DicomMetaDictionary.naturalizeDataset(
    DicomMessage.readFile(arrayBuffer).dict
);
if (!validate(dataset)) {
    console.log(validate.errors);
}
```

Look up rules at runtime:

```js
import {
    getAttributeRule,
    envelope
} from "@dcmjs-org/schemas";

getAttributeRule("00080008");
// { keyword: "ImageType", vr: "CS", vm: "2-n", multi: true }
envelope.values; // "asReturned"
```

## Regeneration

`generate/` holds the generator; run `pnpm run generate-schema` from the
repository root to rebuild the two committed artifacts
(`schema/naturalized.schema.json`, `types/dcmjs-schema.d.ts`).
Regeneration is deterministic — CI fails when the committed artifacts do
not match the generator output.

The package is private until its package-merge review flips it; the
IOD catalog half of the schema work lands later with the validation
package that consumes it.
