---
title: dcmjs before and after 1.0
---

This page is the side-by-side: what dcmjs was in the 0.x line, how you
interacted with it, and what the same library is in 1.0. The code you write
barely changes — the engine underneath it changed completely. For the
step-by-step migration instructions, see [Migrating from 0.x](./from-0x.md);
for how the new engine works, see the
[architecture overview](../architecture/overview.md).

## What dcmjs 0.x was

dcmjs 0.x was an **eager** DICOM Part 10 reader and writer:

- **Reading decoded everything up front.** `DicomMessage.readFile` ran a
  scanning loop that decoded every element's value — and kept a raw copy in
  `_rawValue` — during the call itself. The byte offsets each element came
  from were used once and discarded.
- **The result was (and still is) the tag-keyed `DicomDict`**: a `meta` /
  `dict` split, uppercase string keys (`"00100010"`), entries shaped
  `{ vr, Value, _rawValue }`.
- **`DicomMetaDictionary.naturalizeDataset` / `denaturalizeDataset`**
  converted between that dict and a keyword-named dataset
  (`dataset.PatientName`).
- **Writing re-encoded every element, every time.** `DicomDict.write`
  encoded each element into its own temporary stream, then copied it into
  the destination — even for elements nobody had touched.
- **The dictionary loaded at import time**, including building the ~5000-entry
  `nameMap` before your first line of code ran.
- **A feature stack on top**: anonymizer, structured reporting, derived
  datasets (Segmentation, ParametricMap, StructuredReport), normalizers, and
  the Cornerstone / Cornerstone3D / VTK.js / DICOM Microscopy Viewer
  adapters — plus the chunked `AsyncDicomReader` for streaming sources.

A typical 0.x interaction:

```js
import dcmjs from "dcmjs";
const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

// Read: every value in the file is decoded right here, raw copies and all.
const dicomDict = DicomMessage.readFile(arrayBuffer);

// Naturalize, edit by keyword, denaturalize.
const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
dataset.SeriesDescription = "Edited description";
dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);

// Write: every element is re-encoded from its JavaScript value.
const outBuffer = dicomDict.write();
```

Under the hood, that snippet paid for everything twice. The read decoded a
500 MB `PixelData` you may never have looked at; the write re-encoded all of
it back. And because re-encoding normalizes framing — sequences are emitted
with undefined lengths and delimiters regardless of how the source encoded
them, encapsulated pixel data gets its fragments and basic offset table
regenerated, padding is reapplied — **a read-then-write with zero edits did
not, in general, reproduce the input bytes**. There was no way to fix that: once values
were decoded and offsets thrown away, the original encoding was gone.

## What dcmjs 1.0 is

dcmjs 1.0 is the **same public API on a new engine**. The read core is now
the offsets-only tokenizer vendored from the dicom-parser project
([`@dcmjs/parser`](../architecture/parser-package.md), a private workspace
package in the new [monorepo](../development/monorepo.md)), wired under
`DicomMessage.readFile` by the [lazy core](../architecture/lazy-core.md).
The [writer](../architecture/writer.md) re-encodes only what changed, with
direct destination writes and length backpatching, and emits everything else
as verbatim source bytes.

Here is the **identical** snippet again — not one character changed —
annotated with what now happens underneath:

```js
import dcmjs from "dcmjs";
const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

// Read: one tokenizer pass records WHERE every element lives. No values
// are decoded; every entry's Value/_rawValue is a getter that decodes on
// first access and caches.
const dicomDict = DicomMessage.readFile(arrayBuffer);

// naturalizeDataset touches every entry, so THIS line is now where the
// values materialize. Touch only dicomDict.dict["0008103E"] instead and
// only that element ever decodes.
const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
dataset.SeriesDescription = "Edited description";
dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);

// Write: direct stream writes with length backpatching - no per-element
// temp streams. (Entries rebuilt by denaturalizeDataset re-encode; see
// the note below for keeping untouched elements byte-identical.)
const outBuffer = dicomDict.write();
```

:::note
The full naturalize → denaturalize round trip **replaces every dict entry**
with a freshly built one, so the writer re-encodes them all — exactly the
0.x behavior, no worse. The byte-faithful fast path engages when you keep
the lazy entries and edit by assignment:

```js
const dicomDict = DicomMessage.readFile(arrayBuffer);
dicomDict.dict["0008103E"].Value = ["Edited description"]; // marks it dirty
const outBuffer = dicomDict.write();
// Every OTHER element is emitted as its verbatim source bytes - header,
// items, delimiters, fragment framing. With zero edits, the dataset body
// reproduces the input byte-for-byte.
```

See [Writing and editing](../guides/writing-and-editing.md) for the rules.
:::

## The inventory

### Unchanged

| Area | Notes |
| --- | --- |
| Public API shape | `dcmjs.data.{DicomMessage, DicomDict, DicomMetaDictionary, ...}`; `readFile` → `DicomDict { meta, dict }` → `write()`; `upsertTag` |
| Dict entry shape | `{ vr, Value, _rawValue }` under clean uppercase string keys — getter-backed now, same observable contract |
| `readFile` options | `untilTag`, `includeUntilTagValue`, `noCopy`, `forceStoreRaw`, same semantics; `ignoreErrors` is still accepted (see changed semantics below) |
| Naturalize semantics | Same shapes as 0.x, including the instance-driven scalar collapse (see [naturalized datasets](../guides/naturalized-datasets.md)) |
| Feature stack | Anonymizer, SR, derivations, normalizers, adapters — untouched by the rewiring |
| `AsyncDicomReader` | Unchanged (`dcmjs.async`); re-platforming onto the tokenizer is 1.x work ([roadmap](../development/roadmap.md)) |

### Changed semantics

| Change | Before → after |
| --- | --- |
| Work and error timing | All decode work (and value-level errors) happened during `readFile` → values decode, and their errors throw, at **first access** of `Value`/`_rawValue` |
| `ignoreErrors: true` | Dict silently **truncated** at the failing element → **full** dict; only the failing entry resolves to `undefined`, with a logged warning |
| Editing | Any change was picked up because everything re-encoded → edits must be **assignment-based** (`entry.Value = [...]`, `upsertTag`) to be tracked; in-place mutation of a materialized value is invisible to the passthrough writer |
| Deflated transfer syntax | Declared-deflated files were silently written **uncompressed** (a bug) → the body is really raw-deflated per PS3.10 A.5 — a fix that changes output bytes (see [deflate](../guides/deflate.md)) |
| Logging | Import-time `setLevel` on the global loglevel **root** logger → named child logger `loglevel.getLogger("dcmjs")`; your root logger is never touched |
| `DicomMetaDictionary.nameMap` | Built at import time (~5000 objects) → built lazily on first access; identical contents |
| Invalid stored VR lengths | Always rewritten on re-encode → preserved **verbatim** when the element passes through (`allowInvalidVRLength` gates write-time validation only) |

### Removed

| Removed | Use instead |
| --- | --- |
| `DicomMessage.read` / `DicomMessage.readTag` (deprecated since 0.24) | `DicomMessage.readFile` |
| `DICOMWEB` class | the [dicomweb-client](https://github.com/dcmjs-org/dicomweb-client) package |

### Added

| Added | Where to read more |
| --- | --- |
| Lazy read core (default), with the eager 0.x core as a beta escape hatch (`options.core: "eager"` / `DCMJS_CORE=eager`) | [Lazy core](../architecture/lazy-core.md), [reading guide](../guides/reading.md) |
| Byte-identity passthrough writing: untouched elements emit verbatim source spans, 64 KB+ spans as zero-copy windows | [The writer](../architecture/writer.md) |
| Deflate-on-write for `1.2.840.10008.1.2.1.99` | [Deflate](../guides/deflate.md) |
| `@dcmjs/parser` workspace package with its own 245-test suite and standing performance gates (`bench:parser`, bundle gate, byte-identity suite) | [Parser package](../architecture/parser-package.md), [performance](../performance.md) |
| This documentation site | [Introduction](../intro.md) |

## Why

The 0.x reader and the dicom-parser tokenizer sat at opposite ends of a
one-way street: **offsets can always derive values** — decode lazily, with
any character set, or never — but **eager values can never recover
offsets**, so 0.x could neither defer work nor reproduce a file's exact
bytes. Merging the two projects and making offsets the fundamental
representation gives dcmjs both lazy reads and byte-faithful writes from a
single parse. The full argument is in the
[architecture overview](../architecture/overview.md#why-this-shape-the-derivability-argument).

## Next step

Ready to move code? [Migrating from 0.x](./from-0x.md) is the cookbook:
every removed API, every semantic shift, and the edits (if any) your
codebase needs. Coming from the standalone dicom-parser package instead?
See [Migrating from dicom-parser](./from-dicom-parser.md).
