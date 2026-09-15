---
title: Getting started
---

# Getting started

## Installing

dcmjs **1.0.0-beta.0 is not yet on npm**. The published `dcmjs` package is
still the 0.x line, so for now the only way to use the beta is to build it
from source. The repository is a pnpm monorepo and requires
**Node.js 22.13 or newer**:

```bash
corepack enable
git clone https://github.com/dcmjs-org/dcmjs
cd dcmjs
pnpm install
pnpm run build
```

The build produces `build/dcmjs.es.js` (ESM) and `build/dcmjs.js` (UMD).
Consume them from your own project with `pnpm link`, a `file:` dependency,
or by importing the built bundle directly. Once 1.0 is published this
section becomes the usual `pnpm add dcmjs`.

dcmjs runs in modern browsers and in Node.js with the same API. The only
environment-specific parts of the examples below are how you obtain the
input `ArrayBuffer` and how you save the output.

```js
import dcmjs from "dcmjs";

const { DicomMessage, DicomDict, DicomMetaDictionary } = dcmjs.data;
```

## Getting an ArrayBuffer

In the browser, `fetch` and `File` both hand you one directly:

```js
const arrayBuffer = await (await fetch("instance.dcm")).arrayBuffer();
// or, from an <input type="file">:
const arrayBuffer = await fileInput.files[0].arrayBuffer();
```

In Node.js, slice the read buffer so you get a standalone `ArrayBuffer`
(Node may pool small `Buffer`s inside a larger shared allocation):

```js
import fs from "fs";

const data = fs.readFileSync("instance.dcm");
const arrayBuffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
);
```

`DicomMessage.readFile` accepts an `ArrayBuffer` or a `Uint8Array`.

:::note
With the lazy core (the default), the returned dict keeps a reference to
the source buffer and decodes element values from it on demand - so do not
reuse or detach the buffer while the dict is alive.
:::

## Example 1: read, naturalize, edit, write

The naturalized form is usually the most convenient way to work with a
dataset: hex tags become dictionary keyword properties, sequences become
arrays of plain objects, and single-valued elements collapse to scalars.

```js
import fs from "fs";
import dcmjs from "dcmjs";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

// 1. Read. Returns a DicomDict with .meta (file meta group) and
//    .dict (the dataset), keyed by clean tag strings like "00100010".
const dicomDict = DicomMessage.readFile(arrayBuffer);

// 2. Naturalize the dataset: keyword-named, programmer-friendly.
const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
dataset._meta = DicomMetaDictionary.namifyDataset(dicomDict.meta);

// 3. Edit values by keyword.
console.log(String(dataset.PatientName));
dataset.PatientName = "Anonymous^Patient";
dataset.PatientID = "ANON-0001";

// 4. Denaturalize back to the tag-keyed form and put it in the dict.
dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);

// 5. Write: produces an ArrayBuffer containing a complete Part 10 file.
const outBuffer = dicomDict.write();

// Save (Node). In the browser: new Blob([outBuffer], { type: "application/dicom" })
fs.writeFileSync("anonymized.dcm", Buffer.from(outBuffer));
```

See [Naturalized datasets](guides/naturalized-datasets.md) for the details
of the naturalize/denaturalize round trip, including the `_vrMap` and
`_meta` bookkeeping keys.

:::warning
Denaturalizing replaces every entry in the dict, so the
[byte-faithful passthrough writer](guides/writing-and-editing.md) cannot
apply and the whole file is re-encoded. That is correct output, just not
byte-identical to the input. When you only need to touch a few elements,
Example 2 keeps everything else byte-for-byte intact - and is faster.
:::

## Example 2: read-modify-write directly on the dict

For surgical edits, work on `dicomDict.dict` itself. With the default lazy
core every entry is `{ vr, Value, _rawValue }` where `Value` and
`_rawValue` materialize from the file bytes on first access. Edits are
**assignments**: assigning `entry.Value` marks that element dirty, and on
write only dirty elements are re-encoded - every untouched element is
emitted byte-identical from the source file (when the file is
passthrough-eligible; see [Writing and editing](guides/writing-and-editing.md)).

```js
const dicomDict = DicomMessage.readFile(arrayBuffer);

// Reading a value decodes just that element (lazy materialization).
console.log(dicomDict.dict["00080060"].Value); // e.g. ["CT"]

// Edit by ASSIGNING Value - this is what marks the element dirty.
dicomDict.dict["00100010"].Value = ["Anonymous^Patient"];

// Add or replace an element with upsertTag(tag, vr, values).
dicomDict.upsertTag("00104000", "LT", ["De-identified for research"]);

// Sequences: items are plain dicts of entries; assignment works at any
// depth and dirties the enclosing sequence automatically.
const item = dicomDict.dict["00081115"].Value[0];
item["0020000E"].Value = ["1.2.3.4.5.6.7.8"];

const outBuffer = dicomDict.write();
```

:::warning
Only assignment-based edits are tracked. Mutating a materialized value in
place (`entry.Value.push(x)`, `entry.Value[0] = x`) is invisible to the
dirty tracking, and the writer may emit the original bytes. Always assign a
new value. The full rules are in
[Writing and editing](guides/writing-and-editing.md).
:::

## Next steps

- [Reading DICOM files](guides/reading.md) - every `readFile` option, the
  lazy/eager cores, and error-timing semantics.
- [Writing and editing](guides/writing-and-editing.md) - passthrough
  rules, `writeOptions`, and what the writer can and cannot detect.
- [Architecture overview](architecture/overview.md) - how the lazy core,
  writer, and dictionary fit together.
