---
title: Architecture overview
---

dcmjs 1.0 is organized as a small stack of layers, each of which only knows
about the layers below it. The guiding idea: **parse once into byte offsets,
derive everything else lazily from those offsets.**

## The layers

| Layer | What it is | Where it lives |
| --- | --- | --- |
| 0 — Tokenizer | `@dcmjs/parser`: an offset-recording DICOM Part 10 tokenizer, vendored from dicom-parser. Zero runtime dependencies, no dictionary, no character-set logic. | `packages/parser` |
| 1 — Data model | The lazy read core, the VR (value representation) classes, naturalize/denaturalize, the backpatch writer with the passthrough fast path, and the packed tag dictionary. | `src/` (root) |
| 2 — Features | Anonymizer, structured reporting (SR), derived datasets (Segmentation, ParametricMap, StructuredReport, ...). Built entirely on the layer 1 API. | `src/anonymizer.js`, `src/sr/`, `src/derivations/` |
| Edge — Adapters | Viewer integrations (Cornerstone, Cornerstone3D, VTKjs, DICOMMicroscopyViewer). They consume the public dcmjs API like any external application would. | `src/adapters/` |

As a dependency diagram:

```
  adapters (Cornerstone, Cornerstone3D, VTKjs, ...)   <- external consumers
      |
  layer 2: features (anonymizer, sr/, derivations/)
      |
  layer 1: data model (lazy core, VR classes, writer,
           naturalize/denaturalize, packed dictionary)
      |
  layer 0: @dcmjs/parser (offset tokenizer, dependency-free)
```

Arrows only ever point downward. The parser package never imports from
dcmjs, never touches the dictionary, and never decodes character sets —
those are layer 1 concerns by design.

## Layer 0: the offset tokenizer

`packages/parser` is the dicom-parser tokenizer, vendored whole as the
private workspace package `@dcmjs/parser`. One pass over the buffer
produces an element map where each element records *where its bytes are*,
not what they mean:

```js
{
  tag: "x7fe00010",       // parser-internal string key
  tagValue: 0x7fe00010,   // numeric (group << 16 | element) >>> 0
  vr: "OB",
  length: 1234,
  dataOffset: 5678,       // first byte of the value
  startOffset: 5666,      // first byte of the element header
  endOffset: 6912         // first byte after the element, delimiters included
}
```

No values are decoded during this pass (a handful of tiny plumbing
elements like the transfer syntax aside). See
[The parser package](./parser-package.md) for the full element model.

:::note
`@dcmjs/parser` is a **private** workspace package. Nothing under
`packages/parser` is published to npm, and there is no public subpath
export yet — exposing it is roadmap work (see the
[roadmap](../development/roadmap.md)).
:::

## Layer 1: the data model

Layer 1 turns tokenizer output into the public `DicomDict` shape:

- **Lazy materialization** (`src/lazy/LazyDicomReader.js`):
  `DicomMessage.readFile` runs the tokenizer, then wraps every element in
  a getter-backed entry. The first access of `entry.Value` opens a
  windowed `ReadBufferStream` over the element's byte span and runs the
  same `ValueRepresentation` class the 0.x eager reader used; the result
  is cached. Mechanics in [The lazy read core](./lazy-core.md).
- **Naturalize / denaturalize** (`src/DicomMetaDictionary.js`): keyword
  views over the tag-keyed dict. Because lazy entries expose the same
  `{ vr, Value, _rawValue }` contract as eager ones, naturalize works
  unchanged — it simply materializes what it touches. See
  [Naturalized datasets](../guides/naturalized-datasets.md).
- **The writer** (`src/Tag.js`, `src/DicomMessage.js`, `src/DicomDict.js`):
  elements are written directly into the destination stream with their
  length fields backpatched afterward, and entries that were never edited
  are emitted as verbatim source bytes (the passthrough fast path).
  Details in [The writer](./writer.md).
- **The packed dictionary** (`src/dicom.packed.js`, `src/dictionary.fast.js`):
  the standard tag dictionary ships as generated packed tables that are
  decoded once on demand, instead of a giant object literal parsed at
  import time. See [The dictionary](./dictionary.md).

## Layer 2 and the adapters

Features compose layer 1 without reaching below it: the anonymizer edits
dict entries, SR and the derivation classes build naturalized datasets and
write them back out. The adapters in `src/adapters/` are maintained in
this repository for convenience but architecturally sit outside the stack
— they depend on the public API only, exactly like an external
application.

## The monorepo

dcmjs is a pnpm workspace (`pnpm-workspace.yaml` lists `"."` and
`"packages/*"`):

```
dcmjs/
  src/                  the dcmjs package itself (layers 1 and 2) - the only published package
  test/                 cross-layer test suites (equivalence, passthrough, hardening)
  packages/
    parser/             @dcmjs/parser - layer 0, private, dependency-free
    docs/               this Docusaurus site
```

The root package is `dcmjs` (version `1.0.0-beta.0`); it is the only thing
that publishes. `packages/parser` is consumed through the workspace.
Splitting layer 1 into further packages (data, dictionary, streaming,
features) with subpath exports is deferred 1.x work — see
[Monorepo development](../development/monorepo.md) and the
[roadmap](../development/roadmap.md).

## Why this shape: the derivability argument

The 0.x reader and the upstream dicom-parser sit at opposite ends of a
one-way street:

- **Offsets can always produce values.** Given
  `{ startOffset, dataOffset, length, endOffset }` and the source buffer,
  you can decode the value at any time, with any character set, through
  any VR class — lazily, on first access, or never.
- **Eager values cannot recover offsets.** Once 0.x had decoded
  `PatientName` into a string, the information of *where* those bytes came
  from — including the exact header framing, padding bytes, and
  undefined-length delimiters — was gone. Re-emitting the file meant
  re-encoding every element and hoping the result matched.

Recording offsets is therefore the more fundamental representation:
everything dcmjs 0.x computed is derivable from it, plus things 0.x could
never offer. Two of those are load-bearing:

1. **Lazy reads.** Opening a file costs one tokenizer pass; values decode
   only when touched. See [Performance](../performance.md).
2. **Byte-faithful writes.** An entry that was never edited still knows
   its exact on-disk span (`startOffset`..`endOffset`, delimiters
   included), so the writer copies those bytes verbatim instead of
   re-encoding — which is what makes the no-edit round trip byte-identical
   for eligible files. See [The writer](./writer.md).

This is also why the two extra integer fields (`startOffset`,
`endOffset`) were added to every tokenizer element: `dataOffset` alone is
not enough, because the header size depends on the VR and the corrected
length of undefined-length elements excludes the delimiter items. The span
removes both ambiguities at a cost of two numbers per element.

## Where to go next

- [The parser package](./parser-package.md) — layer 0 in detail
- [The lazy read core](./lazy-core.md) — how reads work
- [The writer](./writer.md) — backpatching and passthrough
- [Reading DICOM](../guides/reading.md) — the user-facing API
- [Migration from 0.x](../migration/from-0x.md) — what changed and why
