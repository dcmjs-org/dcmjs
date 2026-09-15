---
title: Migrating from dcmjs 0.x
---

dcmjs 1.0 is a breaking release. The read path was re-platformed onto a lazy,
offsets-only tokenizer (the vendored dicom-parser engine, see
[the parser package](../architecture/parser-package.md)), and the writer was
rebuilt around byte-faithful passthrough and length backpatching. Most 0.x
code keeps working unchanged — the full 635-test suite passes identically on
both cores. This page is a cookbook of before/after recipes for everything
that changed.

:::note
This page describes `1.0.0-beta.0`. The eager 0.x read core still ships in the
beta as an escape hatch and is scheduled for deletion in 1.x — see the
[roadmap](../development/roadmap.md).
:::

```js
import dcmjs from "dcmjs";
const { DicomMessage, DicomDict, DicomMetaDictionary } = dcmjs.data;
```

## Reading: same call, new timing

`DicomMessage.readFile` is called exactly as before and returns a `DicomDict`
with the same shape — same `meta` / `dict` split, same clean uppercase string
keys (`"00100010"`), same `{ vr, Value, _rawValue }` entries. What changed
is *when* decode work happens: the file is tokenized into offsets up front,
and each entry's value materializes on first access.

```js
// 0.x — every value in the file was decoded inside this call:
const dicomDict = DicomMessage.readFile(arrayBuffer);

// 1.0 — identical call, but it only tokenizes offsets; the patient name
// bytes are decoded (and cached) the first time you touch them:
const name = dicomDict.dict["00100010"].Value; // decode happens HERE
```

Why: parsing cost no longer scales with value sizes, and untouched values
are never decoded — see [performance](../performance.md) and the
[lazy core architecture](../architecture/lazy-core.md). The dict and entry
shapes are pinned in [reading](../guides/reading.md#entry-shape).

### Where to put `try`/`catch` now

The lazy core changes *when* errors surface, not *whether* they do.
Structural errors (missing `DICM`, malformed framing) still throw at
`readFile` time; value-level errors (bytes that cannot be decoded) throw at
first access of that entry.

```js
// 0.x — one try/catch caught everything, structural and value-level:
try {
    useDataset(DicomMessage.readFile(arrayBuffer).dict);
} catch (e) {
    reportUnreadableFile(e);
}
```

```js
// 1.0 — readFile only throws structural errors; value errors surface on
// first access, so the traversal needs coverage too:
let dicomDict;
try {
    dicomDict = DicomMessage.readFile(arrayBuffer);
} catch (e) {
    reportUnreadableFile(e); // truncated stream, missing DICM, ...
}
try {
    useDataset(dicomDict.dict); // first access of a bad entry throws here
} catch (e) {
    reportCorruptElement(e);
}
```

:::tip
If you need 0.x's all-errors-up-front behavior, force full materialization
right after reading — `JSON.stringify(dicomDict.dict)` or
`DicomMetaDictionary.naturalizeDataset(dicomDict.dict)` touch everything — or
use the [eager escape hatch](#escape-hatches). Details in
[error timing](../guides/reading.md#error-timing).
:::

## `ignoreErrors`: truncated dict vs full dict

With `ignoreErrors: true` and a value-level error, 0.x caught the error
mid-scan and returned a dict **truncated** at the failing element. 1.0
returns the **full** dict; only the failing entry resolves to
`Value`/`_rawValue` of `undefined`, with one logged warning per entry. You
get strictly more data back than 0.x did.

```js
const dicomDict = DicomMessage.readFile(arrayBuffer, { ignoreErrors: true });

// 0.x — corruption detection by ABSENCE: tags at and after the bad
// element were simply missing from the dict:
if (!("7FE00010" in dicomDict.dict)) {
    // PixelData (or anything before it) failed — you cannot tell which
}

// 1.0 — every element is present; the failing one resolves to undefined:
if (dicomDict.dict["7FE00010"].Value === undefined) {
    // exactly this entry is bad (one warning was logged);
    dicomDict.dict["00100010"].Value; // everything else still reads
}
```

:::warning
If your 0.x code used the absence of tags after a corrupt element as a
corruption signal, update it to check `Value === undefined`. Structural
errors (a truncated file) still yield a partial dict on both cores. See
[`ignoreErrors`](../guides/reading.md#ignoreerrors).
:::

## Escape hatches

The eager 0.x read core still ships in the beta. Reach for it when you
suspect a lazy-core bug or want an A/B performance comparison — and treat it
as temporary, since it is scheduled for deletion after the beta soak.
`options.core` accepts `"lazy"` or `"eager"`; anything else throws
`Unknown DicomMessage.readFile core`.

```js
// Per call:
const dicomDict = DicomMessage.readFile(arrayBuffer, {
    core: "eager" // default is "lazy"
});
```

```bash
# Globally, e.g. to bisect a suspected lazy-core difference in CI:
DCMJS_CORE=eager npm test
```

## Editing: assignment, not mutation

This is the big practical change. The 1.0 writer emits the original source
bytes verbatim for entries that were never modified
([writer architecture](../architecture/writer.md)), and dirtiness is
**assignment-based**: only `entry.Value = ...`, `entry._rawValue = ...`, and
`DicomDict.upsertTag` mark an entry dirty. In 0.x every element re-encoded on
every write, so in-place mutation of a decoded value "worked" by accident;
under 1.0 it leaves the entry looking clean, and the writer emits the
**original** bytes — silently discarding your change.

### Changing a scalar value

```js
// 0.x — in-place index write, re-encoded on write anyway:
dicomDict.dict["00100010"].Value[0] = "Anonymous^Patient";

// 1.0 — assign a fresh array so the setter can mark the entry dirty:
dicomDict.dict["00100010"].Value = ["Anonymous^Patient"];
```

### Changing a multi-valued element

```js
// 0.x — pushing onto the decoded array worked:
dicomDict.dict["00080008"].Value.push("DERIVED");

// 1.0 — rebuild and assign:
const imageType = dicomDict.dict["00080008"];
imageType.Value = [...imageType.Value, "DERIVED"];
```

### Adding and deleting elements

Neither needs migration. A new entry has no source bytes, so it always
re-encodes; deleting the key removes it from the output. Both 0.x styles of
adding still work:

```js
// The supported helper (0.x and 1.0):
dicomDict.upsertTag("00120062", "CS", ["YES"]); // Patient Identity Removed

// Direct key set of a NEW entry (0.x and 1.0):
dicomDict.dict["00104000"] = { vr: "LT", Value: ["a note"] };

// Deleting an element (0.x and 1.0):
delete dicomDict.dict["00104000"];
```

`upsertTag` on an *existing* tag assigns `Value`, which is tracked — so it is
also the safest way to replace a value.

### Editing inside a sequence item

Assignments inside items are tracked at any depth and dirty every enclosing
sequence up the chain:

```js
const item = dicomDict.dict["00081115"].Value[0];

// 0.x — in-place leaf edit inside an item:
item["0020000E"].Value[0] = "1.2.3.4.5";

// 1.0 — WRONG: the in-place edit above is undetectable and will be lost.
// RIGHT — assign; the whole enclosing SQ chain re-encodes:
item["0020000E"].Value = ["1.2.3.4.5"];
```

### The sequence safety net

*Structural* edits to materialized sequence items — adding or deleting an
item **key** (`item["00080050"] = {...}`, `delete item["0020000E"]`), or
pushing/splicing the item array itself — bypass every setter, but they ARE
detected: the writer re-verifies each materialized sequence's structure
against the parsed source at write time and re-encodes on any mismatch. Only
in-place mutation of a *leaf* entry's materialized value (and swapping two
items with identical key sets) remains undetectable. Full rules in
[writing and editing](../guides/writing-and-editing.md).

:::warning
On a dict without passthrough (eager core, denaturalized, charset-unsafe
source) in-place mutations happen to survive because everything re-encodes.
Do not rely on that — it breaks the moment the same code runs against a
passthrough-eligible file. Always edit by assignment.
:::

## Writing: byte-faithful by default

A read-then-write with zero edits now reproduces the input byte-for-byte — a
guarantee 0.x never had (enforced by a byte-identity suite over the corpus):

```js
const src = new Uint8Array(arrayBuffer);
const dicomDict = DicomMessage.readFile(arrayBuffer);
const out = new Uint8Array(dicomDict.write());

// The dataset body after the meta group is reproduced byte-for-byte;
// for a typical conformant file (zeroed preamble - the writer always
// emits 128 zero bytes - and a meta group that re-encodes identically)
// the whole file matches too:
console.assert(out.length === src.length);
console.assert(out.every((byte, i) => byte === src[i]));
```

The formal guarantee covers the dataset body (the meta group is always
re-encoded because its group length is recomputed) and holds when passthrough
is enabled — UTF-8/ASCII-safe charset, unchanged transfer syntax, lazy-core
read; see
[what disables passthrough](../guides/writing-and-editing.md#what-disables-passthrough).
For deflated targets, byte-identity applies to the pre-deflate body — wrapper
bytes depend on the encoder ([deflate guide](../guides/deflate.md)).

Two `writeOptions` interactions to know about:

- **`fragmentMultiframe: false`** disables passthrough for the whole dict —
  re-fragmenting encapsulated pixel data asks for bytes the source does not
  contain, so everything re-encodes (which is exactly the 0.x behavior).
- **`allowInvalidVRLength`** now gates write-time validation **on the
  re-encode path only**. Byte-faithful passthrough legitimately preserves
  invalid stored lengths verbatim:

```js
// 0.x — rewriting a file with an over-long binary value threw unless
// you passed the flag:
dicomDict.write({ allowInvalidVRLength: true });

// 1.0 — a no-edit rewrite passes the invalid length through verbatim and
// succeeds with the defaults; the validation (and the flag) apply the
// moment that element takes the re-encode path:
dicomDict.write(); // allowInvalidVRLength: false, no throw
```

## Deflate: now real on write

If a dataset's meta declared the deflated transfer syntax
(`1.2.840.10008.1.2.1.99`), 0.x **silently wrote an uncompressed body** under
the deflated UID — producing non-conformant files. 1.0 writes an uncompressed
meta group followed by a raw-deflated (RFC 1951) body, as the standard
requires.

```js
// 0.x — the common workaround: rewrite the TSUID so the bytes and the
// declared syntax agree (i.e. give up on deflate):
dicomDict.meta["00020010"].Value = ["1.2.840.10008.1.2.1"];

// 1.0 — just declare the deflated syntax; the body is actually deflated:
dicomDict.meta["00020010"].Value = ["1.2.840.10008.1.2.1.99"];
const deflated = dicomDict.write(); // uncompressed meta + raw-deflated body
DicomMessage.readFile(deflated); // round-trips (pako inflates on read)
```

:::warning
If you depended on the 0.x bug — for example a downstream consumer that read
the "deflated" file without inflating — that consumer now receives a real
deflate stream. Either keep writing plain explicit little endian (set the
TSUID to `1.2.840.10008.1.2.1` before writing) or teach the consumer to
inflate. Details in the [deflate guide](../guides/deflate.md).
:::

## Removed APIs

`DicomMessage.read` and `DicomMessage.readTag` (deprecated statics, warned
since 0.24) are gone:

```js
// 0.x
const dicomDict = dcmjs.data.DicomMessage.read(bufferStream, syntax);

// 1.0
const dicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);
```

The legacy `DICOMWEB` class was deleted. Use the dedicated
[dicomweb-client](https://github.com/dcmjs-org/dicomweb-client) package.

## Logging: no more root-logger clobbering

0.x called `setLevel(...)` on the global `loglevel` **root** logger at import
time, overriding the host application's log level. 1.0 uses the named child
logger `loglevel.getLogger("dcmjs")` instead.

```js
// 0.x — apps had to restore their own level AFTER importing dcmjs:
import loglevel from "loglevel";
import dcmjs from "dcmjs"; // this import just reset the root level
loglevel.setLevel("info"); // undo the clobber
```

```js
// 1.0 — configure dcmjs's own logger; your root logger is never touched.
// If you relied on dcmjs setting the root level for you, set it yourself.
import { log } from "dcmjs"; // loglevel.getLogger("dcmjs")
log.setLevel("debug");
```

## Dictionary: `nameMap` is built lazily

`DicomMetaDictionary.nameMap` used to be built at import time (~5000
objects). It is now constructed on first access. The contents are identical;
only code that measured or relied on import-time construction can notice.
See [the dictionary](../architecture/dictionary.md).

```js
// 0.x — the ~5000 nameMap objects were built during `import dcmjs ...`.
// 1.0 — built on the first access instead: the first denaturalizeDataset
// or tagAsIntegerFromName call (or direct read) pays the one-time cost:
const entry = DicomMetaDictionary.nameMap["PatientName"];
```

## What needs NO migration

- **`DicomDict` shape** — `meta` / `dict`, clean uppercase string keys, entry
  shape `{ vr, Value, _rawValue }`, `upsertTag`, `write()`.
- **`readFile` options** — `untilTag`, `includeUntilTagValue`, `noCopy`,
  `forceStoreRaw` keep the same semantics; `ignoreErrors` is still accepted
  but now yields a full dict on value errors
  ([see above](#ignoreerrors-truncated-dict-vs-full-dict), and the
  [options reference](../guides/reading.md#options-reference)).
- **Naturalization** — `naturalizeDataset` / `denaturalizeDataset` produce the
  same shapes as 0.x in this beta, including the instance-driven scalar
  collapse (a switch to VM-driven shapes is an open 1.0 decision — see the
  [roadmap](../development/roadmap.md)). Naturalizing a lazy dataset simply
  materializes everything it touches. See
  [naturalized datasets](../guides/naturalized-datasets.md).
- **Character set handling** — the ISO_IR 192 normalize-on-read rewrite is
  kept; per-sequence-item character sets now actually work (an improvement
  over 0.x's single top-level charset). See
  [character sets](../guides/character-sets.md).
- **`AsyncDicomReader`** and the [streaming path](../architecture/streaming.md)
  — unchanged in this release (re-platforming onto the tokenizer is 1.x work).
- **Adapters, SR, anonymizer, derivations** — untouched by the rewiring.

Coming from the `dicom-parser` package instead of dcmjs 0.x? See
[migrating from dicom-parser](from-dicom-parser.md).
