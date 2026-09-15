---
title: Introduction
---

# dcmjs

dcmjs is a pure JavaScript library for reading, writing, and manipulating
DICOM objects in the browser and in Node.js. It parses DICOM Part 10 files
into a tag-keyed dictionary, converts between that dictionary and a
programmer-friendly "naturalized" form (keyword-named properties instead of
hex tags), and writes the result back out as a valid Part 10 stream. On top
of that core it ships utilities for derived objects (Segmentations,
Structured Reports, Parametric Maps), normalizers, an anonymizer, and
adapters for the Cornerstone, Cornerstone3D, VTK.js, and
DICOM Microscopy Viewer ecosystems.

## The 1.0 story

dcmjs 1.0 is the result of merging two long-lived projects into one engine:

- **The dicom-parser tokenizer became dcmjs's read core.** The
  offsets-only tokenizer from the `dicom-parser` project was vendored into
  this repository as a private workspace package and rewired underneath
  `DicomMessage.readFile`. Parsing a file now records *where* every element
  lives instead of decoding every value up front.
- **Reading is lazy by default.** `readFile` returns the same
  `DicomDict` shape as before, but each entry's `Value` and `_rawValue` are
  getter-backed: the bytes are decoded on first access and cached. Files
  open in a fraction of the time, and elements you never touch are never
  decoded. The historical eager reader is kept as an escape hatch
  (`core: "eager"` or the `DCMJS_CORE=eager` environment variable) for the
  beta period. See [Reading DICOM files](guides/reading.md) and the
  [Lazy core](architecture/lazy-core.md) architecture page.
- **The writer is byte-faithful.** Because every lazily read element knows
  its exact byte span in the source file, `DicomDict.write` can emit
  untouched elements verbatim - header, value, items, and delimiters
  byte-identical to the input - and re-encode only what you changed. A
  read-then-write round trip with zero edits reproduces the input body
  byte-for-byte, a guarantee 0.x never had. See
  [Writing and editing](guides/writing-and-editing.md) and the
  [Writer](architecture/writer.md) architecture page.
- **One monorepo.** dcmjs is now a pnpm workspace. The vendored tokenizer
  lives in `packages/parser` as a *private, unpublished* internal package;
  only the `dcmjs` package itself publishes. There is no separate
  `dicom-parser` npm shim and no 0.x compatibility layer - 1.0 is a
  breaking release. See [Monorepo](development/monorepo.md) and
  [Migration from dicom-parser](migration/from-dicom-parser.md).

The public API surface you already know is unchanged in shape:

```js
import dcmjs from "dcmjs";

const { DicomMessage, DicomDict, DicomMetaDictionary } = dcmjs.data;

const dicomDict = DicomMessage.readFile(arrayBuffer);
const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
```

## Who uses dcmjs

dcmjs grew out of the OHIF and QIICR communities and is the DICOM
read/write layer behind a number of medical imaging web applications:

- **OHIF Viewer** uses dcmjs for DICOM object creation and manipulation,
  including Structured Reports and Segmentations.
- **Cornerstone / Cornerstone3D** tooling consumes the adapters that
  originated in this repository (`dcmjs.adapters.Cornerstone`,
  `dcmjs.adapters.Cornerstone3D`) to round-trip annotations and
  segmentations through standard DICOM objects.
- Downstream projects such as dicom-curate build deidentification and
  curation workflows on the dcmjs data layer.

As of early 2025 the 0.x line sees roughly 15,000 weekly npm downloads.

## Current status

The current version is **1.0.0-beta.0** and it is **not yet published to
npm** - `npm install dcmjs` still gives you the latest 0.x release. To try
the beta today, build from source with pnpm as described in
[Getting started](getting-started.md). Remaining work before 1.0 final is
tracked on the [Roadmap](development/roadmap.md).

:::note
The vendored tokenizer package (`@dcmjs/parser`) is internal. It has no
public npm package and no public subpath export; user code should only ever
import from `dcmjs`.
:::

## How these docs are organized

- [Getting started](getting-started.md) - building the beta and a complete
  read/edit/write walkthrough.
- **Architecture** - how the pieces fit:
  [Overview](architecture/overview.md),
  [Parser package](architecture/parser-package.md),
  [Lazy core](architecture/lazy-core.md),
  [Writer](architecture/writer.md),
  [Dictionary](architecture/dictionary.md), and
  [Streaming](architecture/streaming.md).
- **Guides** - task-oriented reference:
  [Reading](guides/reading.md),
  [Writing and editing](guides/writing-and-editing.md),
  [Naturalized datasets](guides/naturalized-datasets.md),
  [Character sets](guides/character-sets.md), and
  [Deflate](guides/deflate.md).
- **Migration** - [from 0.x](migration/from-0x.md) and
  [from dicom-parser](migration/from-dicom-parser.md).
- [Performance](performance.md) - what lazy reading and the passthrough
  writer buy you, with numbers.
- **Development** - [Monorepo](development/monorepo.md) and
  [Roadmap](development/roadmap.md).
