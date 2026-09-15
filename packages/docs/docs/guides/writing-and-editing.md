---
title: Writing and editing
---

# Writing and editing

`DicomDict.write(writeOptions)` serializes the dict back into a complete
DICOM Part 10 stream and returns it as an `ArrayBuffer`:

```js
import dcmjs from "dcmjs";
const { DicomMessage } = dcmjs.data;

const dicomDict = DicomMessage.readFile(arrayBuffer);
dicomDict.dict["00100010"].Value = ["Anonymous^Patient"];

const outBuffer = dicomDict.write(); // ArrayBuffer
```

The output is always: 128-byte preamble, `DICM`, the file meta group
(re-encoded with a recomputed group length; a TransferSyntaxUID entry is
added if missing, defaulting to explicit little endian), then the dataset
body in the transfer syntax named by `meta["00020010"]`. When that syntax
is the deflated transfer syntax (`1.2.840.10008.1.2.1.99`), the body is
produced as explicit little endian and then raw-deflated - see
[Deflate](deflate.md).

Elements are written in sorted tag order.

## Passthrough: byte-faithful writing

A dict produced by the default lazy read core remembers, for every
element, the exact byte span it occupied in the source file. On write,
every element that is still **clean** (never assigned) is emitted as those
verbatim source bytes - header, value, sequence items, and delimiters
byte-identical, including whole sequence subtrees and the entire
encapsulated PixelData run. Only dirty or new elements are re-encoded.

Two consequences:

- a read-then-write with zero edits reproduces the input **body**
  byte-for-byte (the meta group is always re-encoded because its group
  length is recomputed);
- writing is much faster, since untouched bytes are copied instead of
  decoded and re-encoded - see [Performance](../performance.md).

Passthrough is per-element and degrades gracefully: an element that cannot
pass through is simply re-encoded, which is exactly what 0.x did for every
element.

### What disables passthrough

For the **whole dict**:

- **A charset-unsafe source.** Passthrough of string-bearing elements is
  only safe when the writer's UTF-8 normalization is byte-identical to the
  source encoding. That holds when the file's top-level
  SpecificCharacterSet (0008,0005) is absent, empty, ASCII
  (`ISO_IR 6` / single-valued `ISO 2022 IR 6`), or already UTF-8
  (`ISO_IR 192`). Anything else - notably the very common `ISO_IR 100`
  (Latin-1) - disables passthrough for the dict, and everything re-encodes
  (with values normalized to UTF-8 and SpecificCharacterSet rewritten to
  `ISO_IR 192`, the normalize-on-read rule described in
  [Character sets](character-sets.md)).
- **A transfer syntax change.** If `meta["00020010"]` no longer matches
  the source's transfer syntax, every element re-encodes into the new
  syntax. (Deflated and explicit little endian count as the same *body*
  syntax: the deflated syntax differs only in the stream-level deflate
  wrapper, so clean entries from a deflated source still pass through into
  the pre-deflate body stream, and vice versa.)
- **Non-default encoding `writeOptions`.** An option that changes how
  bytes are produced asks for bytes the source file does not contain.
  Today that is `fragmentMultiframe: false` (re-fragmenting encapsulated
  pixel data); passing it disables passthrough for the whole dict.
  `allowInvalidVRLength` is deliberately *not* in this set - see below.
- A dict that did not come from the lazy core at all (built by hand, read
  with `core: "eager"`, or read through the
  [whole-file eager fallback](reading.md#the-whole-file-eager-fallback))
  has no source spans and always re-encodes.

For **individual elements**:

- any entry that was assigned (`_dirty`), created by `upsertTag` or
  denaturalize, or transplanted from another dict;
- the top-level SpecificCharacterSet entry itself, whose stored value is
  rewritten to `["ISO_IR 192"]` on read and therefore never represents the
  source bytes;
- `untilTag` stub entries;
- sequence entries with a nested assignment, an in-item
  SpecificCharacterSet, or a detected structural edit (next section).

## Editing rules under the lazy core

The dirty tracking that powers passthrough is **assignment-based**. Read
this section if you edit `dicomDict.dict` directly; the exact contract is
documented at length in the `src/lazy/LazyDicomReader.js` module docblock.

### Assignments are tracked

```js
// All of these are detected and re-encode exactly what they touch:
entry.Value = ["NEW^VALUE"];          // top-level assignment
entry._rawValue = ["NEW^VALUE "];     // raw assignment (also marks dirty)
item["00081150"].Value = ["1.2.3"];   // assignment inside a sequence item,
                                      // at any depth - it dirties every
                                      // enclosing SQ up the chain
dicomDict.upsertTag("00104000", "LT", ["note"]); // add or replace
```

Assigning `Value` or `_rawValue` flips the entry's dirty flag, and a
nested assignment inside a sequence item automatically dirties the whole
enclosing sequence chain, so the writer re-encodes the affected subtree
and passes everything else through.

### In-place mutation is NOT tracked

:::warning
In-place mutation of a materialized value is **undetectable**. These edits
leave the entry looking clean, and the passthrough writer will emit the
**original** source bytes - silently discarding your change:

```js
entry.Value.push("EXTRA");        // NOT detected
entry.Value[0] = "CHANGED";       // NOT detected
new Uint8Array(entry.Value[0])[0] = 0xff; // mutating binary bytes: NOT detected
item["00081150"].Value[0] = "X";  // in-place leaf edit inside an item: NOT detected
```

Always make a fresh assignment instead:

```js
entry.Value = [...entry.Value, "EXTRA"];
entry.Value = ["CHANGED"];
item["00081150"].Value = ["X"];
```

(On a dict without passthrough - eager core, denaturalized, charset-unsafe
source - in-place mutations happen to survive because everything
re-encodes. Do not rely on that: it changes the moment the same code runs
against a passthrough-eligible file.)
:::

### Structural sequence edits ARE detected (at write time)

Item dicts returned by a materialized sequence are plain objects, so
adding or deleting a *key* in one, or pushing/splicing the item array
itself, bypasses every setter. Because such edits would otherwise be
silently dropped, the writer re-verifies every **materialized** sequence
entry's structure against the parsed source at write time, and re-encodes
the sequence on any mismatch. Detected per item, in order:

- item count changes (`sq.Value.push(newItem)`, `sq.Value.splice(0, 1)`);
- per-item key adds and deletes (`item["00080050"] = {...}`,
  `delete item["0020000E"]`);
- whole-entry replacement by a foreign object, or an entry transplanted
  from another sequence;
- the same checks recursively inside materialized nested sequences.

Sequences that never materialized cannot have been structurally edited and
stay clean without being decoded.

Still **undetectable** even with this check: in-place mutation of a leaf
entry's materialized value (the warning above), and swapping two items
that have identical key sets within the same sequence.

### `upsertTag`

`dicomDict.upsertTag(tag, vr, values)` is the supported way to add an
element: it assigns `Value` on an existing entry (tracked, as above) or
creates a fresh `{ vr, Value }` entry for a new tag. Entries created this
way carry no source span and always re-encode - which is the only correct
option for a value the source file never contained.

```js
dicomDict.upsertTag("00120062", "CS", ["YES"]); // Patient Identity Removed
```

## `writeOptions` reference

`write(writeOptions = { allowInvalidVRLength: false })`

- **`allowInvalidVRLength`** (default `false`) - gates *write-time
  validation on the re-encode path only*. When `false`, re-encoding a
  binary value that exceeds its VR's maximum length throws (over-long
  *string* values only log). When `true`, the length check is skipped.
  Under passthrough this option is moot by design: byte-faithful
  passthrough legitimately preserves invalid stored lengths, so a no-edit
  rewrite of a file with an over-long value succeeds even with
  `allowInvalidVRLength: false` - the validation applies the moment that
  element (or the whole dict) takes the re-encode path. This behavior is
  pinned by `test/data.test.js`.
- **`fragmentMultiframe`** (default `true`) - whether multi-frame
  encapsulated pixel data is written as one fragment per frame. Setting it
  to `false` is a non-default *encoding* option and disables passthrough
  for the whole dict (the source bytes do not contain the requested
  fragmentation).

```js
const out = dicomDict.write({ allowInvalidVRLength: true });
```

## See also

- [Writer architecture](../architecture/writer.md) - passthrough,
  backpatching, and deflate-on-write internals.
- [Reading DICOM files](reading.md) - entry shape and lazy
  materialization.
- [Deflate](deflate.md) - writing the deflated transfer syntax.
- [Character sets](character-sets.md) - why non-UTF-8 sources re-encode.
- [Performance](../performance.md) - measured passthrough speedups.
