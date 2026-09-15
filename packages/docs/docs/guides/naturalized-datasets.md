---
title: Naturalized Datasets
---

dcmjs reads files into the DICOM JSON model: a dictionary keyed by 8-character
hex tag strings, where every attribute is `{ vr, Value, _rawValue }`.
`DicomMetaDictionary.naturalizeDataset` converts that into a "naturalized"
dataset keyed by dictionary keywords (`PatientName`, `StudyInstanceUID`, ...),
which is what most application code -- including OHIF and the dcmjs adapters --
programs against. `denaturalizeDataset` converts back so the result can be
written with [`DicomDict.write`](./writing-and-editing.md).

```js
const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const dicomData = DicomMessage.readFile(arrayBuffer);
const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict);
dataset._meta = DicomMetaDictionary.namifyDataset(dicomData.meta);

console.log(dataset.Modality); // "MR"
console.log(String(dataset.PatientName)); // "Doe^John"

// ...edit the dataset...
dataset.SeriesDescription = "Edited series";

// convert back and write
dicomData.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
const outBuffer = dicomData.write();
```

For datasets built from scratch, `dcmjs.data.datasetToDict`,
`datasetToBuffer`, and `datasetToBlob` wrap the denaturalize-and-write steps;
they require the `_meta` convention described below.

:::note
On the 1.0 [lazy core](../architecture/lazy-core.md), naturalizing a dataset
materializes every element it touches -- which for a full naturalize is the
whole dataset. That is semantically what "give me the whole dataset as
keywords" means, but if you only need a few values, reading them through
`dicomData.dict["00080060"].Value` keeps the rest of the file lazy.
:::

## Value-shape rules (as they are today)

These are the 0.x rules, carried into 1.0-beta unchanged. Several of them are
explicitly open API decisions for 1.0 final -- see the last section.

### Keywords come from the dictionary; unknown tags keep their hex name

Each tag is renamed to its [dictionary](../architecture/dictionary.md) keyword.
A tag with no dictionary entry (most private tags) stays under its 8-character
hex string, e.g. `dataset["00091001"]`.

### Single-value collapse

If an attribute's `Value` array has exactly one element, the array is
collapsed:

- a single primitive (string, number) becomes a bare scalar:
  `Value: ["MR"]` naturalizes to `dataset.Modality === "MR"`;
- a single object (a sequence item, a PN component object) becomes a
  one-element array wrapped in a proxy that also forwards property access to
  item zero (the `addAccessors` dual array/object shape).

Multi-valued attributes stay plain arrays:
`dataset.ImageOrientationPatient` is `[1, 0, 0, 0, 1, 0]`.

### Sequences

`SQ` values become arrays of recursively naturalized item datasets. A
single-item sequence gets the dual shape, so both spellings work:

```js
// dual array/object access on a single-item sequence
dataset.SharedFunctionalGroupsSequence[0].PixelMeasuresSequence;
dataset.SharedFunctionalGroupsSequence.PixelMeasuresSequence; // same item
Array.isArray(dataset.SharedFunctionalGroupsSequence); // true
```

### Person names

`PN` values are DICOM JSON component objects
(`{ Alphabetic, Ideographic, Phonetic }`) with `toString`/`toJSON` accessors,
so `String(dataset.PatientName)` yields the Part 10 string form. The
naturalized dataset itself is wrapped in a proxy whose set-trap normalizes
assignments to PN keywords: assigning a plain string
(`dataset.PatientName = "New^Name"`) stores the boxed component form, and
serializing it produces `[{ "Alphabetic": "New^Name" }]`.

### Empty and bulk attributes

A type 2 attribute present with no `Value` naturalizes to `null`. Attributes
carrying `InlineBinary` or `BulkDataURI` instead of `Value` naturalize to
`{ InlineBinary }` / `{ BulkDataURI }` objects.

### `_meta` and `_vrMap`

Two magic keys ride along on naturalized datasets:

- `_vrMap` records the original VR for attributes whose dictionary VR is
  data-dependent (`ox`, e.g. PixelData) or differs from the dictionary;
  `denaturalizeDataset` consults it to restore the right VR.
- `_meta` is a convention, not something `naturalizeDataset` produces: code
  that writes naturalized datasets (`datasetToDict` and the derivation
  classes) expects `dataset._meta` to hold the file meta information, usually
  produced with `namifyDataset(dicomData.meta)`.

`denaturalizeDataset` silently skips both names.

## Footguns

:::warning structuredClone fails
Naturalized datasets contain proxies (the dataset wrapper and every
single-item sequence), and the structured clone algorithm cannot clone Proxy
objects -- `structuredClone(dataset)` throws `DataCloneError`. Clone via
`naturalizeDataset` on the source dict again, or accept the lossy
`JSON.parse(JSON.stringify(dataset))` (which flattens the proxy shapes).
:::

:::warning Scalar-vs-array instability
The single-value collapse is instance-driven, not VM-driven. The same
attribute can be a scalar in one file and an array in another
(`dataset.ImageType` with one value is a string; with four values it is an
array), so consuming code must handle both shapes. This is the single most
common dcmjs 0.x complaint and is the subject of an open 1.0 decision (below).
:::

:::warning Private tags are dropped on denaturalize
`naturalizeDataset` keeps unknown tags under their hex names, but
`denaturalizeDataset` only emits names it finds in the name map. Hex-named
entries are dropped with nothing but a `log.warn("Unknown name in dataset",
...)` -- a naturalize/denaturalize round trip silently loses private data.
If you must preserve private tags, edit the tag-keyed `dicomData.dict`
directly instead (see [Writing and editing](./writing-and-editing.md)).
:::

:::warning Naturalizing disables byte-faithful passthrough
Entries built by `denaturalizeDataset` are new objects with no source-span
bookkeeping, so the 1.0 passthrough writer re-encodes all of them. A
read-naturalize-denaturalize-write cycle is value-faithful (pinned by the
round-trip suites) but not byte-faithful; editing `dicomData.dict` entries in
place keeps untouched elements byte-identical.
:::

Also note that `denaturalizeDataset` stringifies numbers, truncates values
longer than the VR's maximum length (with a warning), and throws if a value
array contains `undefined`.

## Open 1.0 API decisions

The following are explicitly flagged as unresolved 1.0 decisions in the
project plan, so this surface may change before 1.0 final (see the
[roadmap](../development/roadmap.md) and [migration notes](../migration/from-0x.md)):

- **VM-driven value shapes**: replace the instance-driven single-value
  collapse with shapes derived from the dictionary VM (VM 1 always scalar,
  VM 1-n always array).
- **Private-tag-preserving denaturalize**: record VRs for hex-named entries in
  `_vrMap` and re-emit them under their tags instead of dropping them.
- **Formalizing `_meta`/`_vrMap`** on a `DicomDataset` class rather than magic
  keys.
- A lazy keyword facade so `dataset.PatientName` materializes one element
  instead of the whole file.
