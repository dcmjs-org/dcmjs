---
title: Migrating from dicom-parser
---

This page is for users of the standalone
[dicom-parser](https://github.com/cornerstonejs/dicomParser) npm package.

## Status

The dicom-parser repository is dormant. Its tokenizer lives on inside dcmjs:
it was vendored whole as the private workspace package `@dcmjs/parser` and is
now the engine under `DicomMessage.readFile`'s default lazy core, with its
ported byte-level test suite (245 tests) and standing
[non-regression gates](../performance.md) keeping it healthy — the vendored
tokenizer currently parses *faster* than the published `dicom-parser@1.8.21`
on every file in its own test corpus.

Two things to be clear about:

- **No compatibility shim will be published** under the `dicom-parser` npm
  name. dcmjs 1.0 is the migration target.
- **The raw tier is not yet public.** `@dcmjs/parser` is a private package in
  the dcmjs monorepo. A public subpath export (something like
  `dcmjs/parser`) exposing the raw offsets-and-accessors tier is on the
  [roadmap](../development/roadmap.md), tracked alongside the packaging
  subpath split. Until then, the supported surface is `DicomMessage.readFile`
  — which, thanks to laziness, has the same "pay only for what you touch"
  cost profile you used dicom-parser for.

## Concept mapping

dicom-parser gave you a `dataSet` of offset-only elements plus typed
accessors. dcmjs gives you a lazy `DicomDict` (string-keyed entries whose
values decode on first access) and, one level up, naturalized datasets with
dictionary keywords.

| dicom-parser | dcmjs 1.0 |
| --- | --- |
| `dataSet.string("x00100010")` | `dicomDict.dict["00100010"].Value` (lazy entry, decodes on first access) or `dataset.PatientName` after `naturalizeDataset` |
| `dataSet.uint16("x00280010")` | `dicomDict.dict["00280010"].Value[0]` — the VR class (US) does the typed decode for you |
| `dataSet.elements["x..."].dataOffset` / `.length` | entry spans: each lazy entry carries a `_sourceSpan` `{ startOffset, endOffset, buffer }` covering the element's exact on-disk encoding, header and delimiters included |
| `element.items` (sequences) | `dict["..."].Value` is an array of item dicts, wrapped lazily — no byte rescans |
| `dicomParser.readEncapsulatedImageFrame(dataSet, el, i)` | the lazy `PixelData` entry: encapsulated frames materialize from the fragment/basic-offset-table indexes on access, zero-copy for single-fragment frames |
| `parseDicom(bytes, { untilTag: "x00080060" })` | `DicomMessage.readFile(buffer, { untilTag: "00080060", includeUntilTagValue: true })` — clean-string tag keys, explicit control over whether the boundary element's value is kept |
| `dataSet.warnings` | recoverable problems are logged through the named `dcmjs` logger; with `ignoreErrors: true`, a failing entry resolves to `Value === undefined` with one warning per entry instead of truncating the dataset |
| `try { parseDicom } catch ({ exception, dataSet })` partial results | `readFile(buffer, { ignoreErrors: true })` returns the full dict; value-level errors surface at first access of the broken entry |
| `options.inflater` for deflated files | built in — pako is wired as the default inflater |

Tag key format changes from parser keys (`"x00100010"`, lowercase with an `x`
prefix) to dcmjs clean keys (`"00100010"`, uppercase, no prefix).

A minimal before/after:

```js
// dicom-parser
const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
const name = dataSet.string("x00100010");
const rows = dataSet.uint16("x00280010");
```

```js
// dcmjs 1.0
const dicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);
const name = dicomDict.dict["00100010"]?.Value?.[0]; // decoded on this access
const rows = dicomDict.dict["00280010"]?.Value?.[0];

// or with keywords:
const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
console.log(dataset.PatientName, dataset.Rows);
```

See the [reading guide](../guides/reading.md) and
[lazy core architecture](../architecture/lazy-core.md) for details.

## What you gain

- **A write path.** dicom-parser was read-only. dcmjs writes — and for files
  you did not edit, the passthrough writer reproduces the input
  byte-for-byte; edited files re-encode only the dirty elements. See
  [writing and editing](../guides/writing-and-editing.md).
- **A data dictionary.** Keyword access (`dataset.PatientName`), VR lookup for
  implicit-VR files, private dictionaries — none of which dicom-parser
  bundled (by design). See the [dictionary](../architecture/dictionary.md).
- **Character set decoding.** dicom-parser's string accessors are
  byte-identity latin only. dcmjs resolves `SpecificCharacterSet` per dataset
  *and per sequence item* and decodes through `TextDecoder`. See
  [character sets](../guides/character-sets.md).
- **Higher-level toolkits.** Naturalized datasets, SR utilities, adapters,
  anonymizer.

## What to wait for

- **A public raw-tier subpath** — direct access to `parseDicom`, the offsets
  `dataSet`, and helpers like `readEncapsulatedImageFrame` without going
  through `DicomDict`. The seed exists (the package, its tests, its `.d.ts`);
  the public packaging decision is deliberately deferred until the subpath
  export split. If you need the raw tier today, the pragmatic options are to
  keep using the published `dicom-parser@1.8.21` (frozen but stable) or to
  consume the monorepo source directly.
- **A TypeScript surface** for the dcmjs side. The parser already carries
  type declarations (`packages/parser/index.d.ts`); top-level dcmjs types are
  1.x work.

Both items are on the [roadmap](../development/roadmap.md).
