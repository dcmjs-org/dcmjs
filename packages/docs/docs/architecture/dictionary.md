---
title: The Packed Dictionary
---

dcmjs ships the full DICOM data dictionary (PS3.6 attributes plus PS3.7
command fields, retired tags, repeating-group ranges, and a large private-tag
dictionary). Naively, that is megabytes of JavaScript object literals that
every importer pays to parse and allocate at startup. The packed dictionary
system replaces the literals with base64-encoded typed-array tables that are
decoded once, on first use -- measured with the project's own benchmark
(`generate/bench-dictionary-load.mjs`), import cost dropped from 181 ms to
19 ms (9.5x).

## The three layers

### `src/dicom.packed.js` -- the data

Auto-generated. The standard dictionary is flattened into parallel arrays,
each base64-encoded into the source file:

- `groups` (`Uint16Array`) and `groupStart` (`Uint32Array`): the sorted list
  of group numbers and the index where each group's elements begin;
- `elems` (`Uint16Array`): element numbers, sorted within each group;
- `vrCode` / `vmCode` (`Uint8Array`): per-entry indexes into small `vrTable` /
  `vmTable` string tables (there are only a few dozen distinct VR/VM strings);
- `nameBlob` (one concatenated string) with `nameOff` (`Uint32Array`) and
  `nameLen` (`Uint16Array`): every keyword, sliced out on demand.

`initPacked()` decodes the base64 payloads into typed arrays exactly once and
memoizes the result; importing the module costs almost nothing.

### `src/dicom.lookup.js` -- the lookups

`lookupTagHex("00080005")` resolves a tag by:

1. finding the group's span via a lazily built `Map<group, index>`;
2. binary-searching `elems` within that span;
3. assembling `{ vr, vm, name }` from the code tables and the name blob.

`lookupTagRangeHex` covers the repeating groups (Curve `50xx` and Overlay
`60xx` ranges) via `src/dictionary.ranges.data.js`, consulted when the exact
lookup misses. `getAllStandardTagEntries()` iterates the whole packed table
plus ranges -- used only to build the name map (below).

### `src/dictionary.fast.js` -- the public facade

`DicomMetaDictionary.dictionary` is a `Proxy` that accepts both key styles --
punctuated `"(0008,0005)"` and clean `"00080005"` -- and memoizes every
resolved entry in a cache, so repeated lookups of the same tag are a plain
`Map.get`. The `has` trap supports `tag in dictionary`. `registerTag` lets
applications inject entries for tags outside the standard and private
dictionaries:

```js
const { DicomMetaDictionary } = dcmjs.data;

DicomMetaDictionary.dictionary["(0010,0010)"];
// { tag: "(0010,0010)", vr: "PN", vm: "1", name: "PatientName", version: "DICOM" }
DicomMetaDictionary.dictionary["7FE00010"].name; // "PixelData"
```

## Private and range dictionaries

Private tags (keyed by creator-quoted strings such as
`(0019,"SIEMENS MR HEADER",08)`) live in `src/dictionary.private.data.js`,
packed by the same technique. The privates module is registered at import time
as a thin lambda (`registerPrivatesModule` in `src/index.js`), but its base64
index decode only runs on the first private-tag lookup -- importing dcmjs does
no private-dictionary work.

## The lazy name map

`DicomMetaDictionary.nameMap` (keyword to entry, the reverse map that
`denaturalizeDataset` and `tagAsIntegerFromName` use) materializes roughly
5,000 entry objects. In 0.x it was built at import time; in 1.0 it is a
memoizing static getter built on first access from
`getAllStandardTagEntries()`. All existing access patterns
(`nameMap[name]`, `name in nameMap`, the `denaturalizeDataset` default
argument) go through the getter unchanged.

## The `generate/` pipeline

The packed modules are build artifacts with a documented provenance:

- `generate/generate-dictionary.js` -- regenerates the source dictionary from
  the DICOM standard itself: it downloads the PS3.6 and PS3.7 docbook XML from
  `dicom.nema.org`, extracts attribute and command-field tables (marking
  retired entries `RETIRED_`), and merges new tags into
  `generate/dictionary.mjs`.
- `generate/pack_dicom.mjs` -- flattens `dictionary.mjs` (exact
  `(GGGG,EEEE)` tags only) into the sorted parallel arrays, deduplicates VR/VM
  strings into code tables, concatenates names into the blob, and emits
  `src/dicom.packed.js` with base64 payloads.
- `generate/pack_private.mjs` and `generate/pack_ranges.mjs` -- the same for
  the private and repeating-group dictionaries.
- `generate/bench-dictionary-load.mjs` -- the load-time benchmark (old
  literal dictionary vs. packed, plus ESM vs. UMD bundle import), the source
  of the 181 ms to 19 ms measurement.

## Why this matters for the rest of dcmjs

Dictionary lookups sit on the hot path: implicit-VR reads resolve a VR per
element, the lazy core's `vrCallback` consults the dictionary while
tokenizing, and `UN` elements with known dictionary VRs are re-parsed as their
real type. The packed system keeps all of that at binary-search-plus-memo
cost while keeping startup nearly free -- see
[Performance](../performance.md) and the
[lazy core](./lazy-core.md) for where lookups are consumed, and
[Monorepo development](../development/monorepo.md) for how to regenerate the
packed files.
