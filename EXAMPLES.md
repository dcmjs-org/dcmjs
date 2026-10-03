# dcmjs by example

Adapted from `EXAMPLES.md` on the `docs/examples` branch of
[awatson1978/dcmjs-commands](https://github.com/awatson1978/dcmjs-commands) —
that document tours the CLI wrappers; this one tours the library APIs
underneath them, as they exist on this branch. The design goal is the same
throughout: work *streaming* — bytes pass through the library piece by piece,
so the same code that handles a 500 KB CT slice handles a video instance
measured in gigabytes without loading it into memory. Every example below was
run against real files before being written down.

## Setup

From a checkout of this branch:

```bash
pnpm install
pnpm run build
```

The snippets are ES modules. Save each one as a `.mjs` file in the repo root
and run it with `node` from there — they import the built bundle as
`./build/dcmjs.es.js`. (From an application that depends on the published
package you would write `import dcmjs from "dcmjs"` instead; the API surface
is identical.) Everything streaming lives under `dcmjs.eventStream`:

```js
import dcmjs from "./build/dcmjs.es.js";
const { DicomEventStream, NaturalizedListener, StreamingPart10Writer } = dcmjs.eventStream;
```

The examples read data from `/tmp/dcmjs-examples-data`; the
[test drive](#a-test-drive-for-reviewers) section below shows how to fetch
every file used here.

---

## Read a file the classic way

`DicomMessage.readFile` is the eager path everyone knows: whole buffer in,
parsed dataset out. It still works exactly as before.

```js
import fs from "node:fs";
import dcmjs from "./build/dcmjs.es.js";

const bytes = fs.readFileSync("/tmp/dcmjs-examples-data/multiframe-ultrasound.dcm");
const dicomDict = dcmjs.data.DicomMessage.readFile(bytes.buffer);
const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
console.log(dataset.Modality, dataset.NumberOfFrames);
// US 29
```

## Force-read a file with a missing header

Files whose 128-byte preamble + `DICM` marker were stripped by an exporter
(a common DIMSE-adjacent shape) used to be a dead end (issue #93). Now
`allowMissingHeader: true` is an explicit opt-in that accepts preamble-less
files, and even bare datasets with no file meta group at all (transfer syntax
sniffed from the first element header):

```js
import fs from "node:fs";
import dcmjs from "./build/dcmjs.es.js";

const bytes = fs.readFileSync("/tmp/dcmjs-examples-data/multiframe-ultrasound.dcm");
// simulate an export that stripped the 128-byte preamble + "DICM" marker
const headerless = bytes.buffer.slice(132);

try {
  dcmjs.data.DicomMessage.readFile(headerless);
} catch (e) {
  console.log("strict read:", e.message);
  // strict read: Invalid DICOM file, expected header is missing
}
const dicomDict = dcmjs.data.DicomMessage.readFile(headerless, { allowMissingHeader: true });
const ds = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
console.log("lenient read:", ds.Modality);
// lenient read: US
```

The default stays strict — nobody silently parses garbage.

## Stream a file to a naturalized dataset

`DicomEventStream` is the facade over the event-stream engine. Point it at
anything that yields bytes — a Node read stream, a WHATWG `ReadableStream`,
an async iterable, or a plain buffer — and ask for the shape you want. The
parser sees chunks, never the whole file:

```js
import fs from "node:fs";
import dcmjs from "./build/dcmjs.es.js";
const { DicomEventStream } = dcmjs.eventStream;

const events = DicomEventStream.fromPart10Stream(
  fs.createReadStream("/tmp/dcmjs-examples-data/multiframe-ultrasound.dcm")
);
const dataset = await events.toNaturalized();
console.log(dataset.Modality, "frames:", dataset.NumberOfFrames, "rows:", dataset.Rows);
// US frames: 29 rows: 708
```

The same facade has `toDicomWebJson()`, `toDataSet()` (a tag-keyed
`{ meta, dict }` tree) and `toPart10()`. Deflated transfer syntax
(`1.2.840.10008.1.2.1.99`) inflates transparently on the way in:

```js
const ds = await DicomEventStream.fromPart10Stream(
  fs.createReadStream("/tmp/dcmjs-examples-data/deflate/deflate_tests/image_dfl")
).toNaturalized();
console.log(ds.Modality, ds.SOPClassUID);
// OT 1.2.840.10008.5.1.4.1.1.7
```

If you want the listener itself (its `meta`, its cardinality-violation
report), drive it explicitly — `toNaturalized()` is just sugar over
`NaturalizedListener`:

```js
const { NaturalizedListener } = dcmjs.eventStream;
const listener = await events.process(new NaturalizedListener());
console.log(listener.result.Modality, listener.meta.TransferSyntaxUID);
// US 1.2.840.10008.1.2.4.50
```

## Pull events and stop early

`asyncIterable()` turns any stream into `for await`-able `{ type, args }`
events with real backpressure. Breaking out of the loop *cancels the parse* —
so "what modality is this 4 GB file?" costs a few kilobytes of reading, not a
full pass:

```js
import fs from "node:fs";
import dcmjs from "./build/dcmjs.es.js";
const { DicomEventStream } = dcmjs.eventStream;

const events = DicomEventStream.fromPart10Stream(
  fs.createReadStream("/tmp/dcmjs-examples-data/multiframe-ultrasound.dcm")
);
let currentTag = null;
for await (const ev of events.asyncIterable()) {
  if (ev.type === "startElement") currentTag = ev.args[0];
  if (ev.type === "value" && currentTag === "00080060") {
    console.log("Modality:", ev.args[0]);
    break; // early exit cancels the underlying parse
  }
}
// Modality: US
```

## Copy file-to-file without holding the dataset

`StreamingPart10Writer` is the sink twin of the streaming reader: events in,
Part 10 bytes out, incrementally. Nothing ever holds the whole dataset, and
backpressure flows end to end — the fs write stream's drain gates the writer,
which gates the parser:

```js
import fs from "node:fs";
import dcmjs from "./build/dcmjs.es.js";
const { DicomEventStream, StreamingPart10Writer } = dcmjs.eventStream;

const src = "/tmp/dcmjs-examples-data/multiframe-ultrasound.dcm";
const dst = "/tmp/dcmjs-examples-data/copy.dcm";

const out = fs.createWriteStream(dst);
let pending = Promise.resolve();
const writer = new StreamingPart10Writer({
  onChunk(chunk) {
    if (!out.write(chunk)) {
      pending = new Promise(resolve => out.once("drain", resolve));
    }
  }
});
writer.setDrain(() => pending);

await DicomEventStream.fromPart10Stream(fs.createReadStream(src)).process(writer);
out.end();
console.log("wrote", dst, writer.bytesWritten, "bytes");
// wrote /tmp/dcmjs-examples-data/copy.dcm 3099806 bytes
```

The copy is not byte-identical by design (undefined-length sequences,
recomputed group lengths) but it is semantically equal — it re-parses to the
same dataset. For the collect-then-write shape (small datasets, no streaming
needed) use `Part10Writer` — or just `events.toPart10()`, which wraps it.

## Look inside encapsulated pixel data

The contract keeps encapsulation visible: `startBinary` carries the Basic
Offset Table, and each on-wire fragment arrives as its own `binaryFragment`.
A listener is a plain object of `method(next, ...args)` filters — call
`next(...)` to pass the event along, or don't, to swallow it:

```js
import fs from "node:fs";
import dcmjs from "./build/dcmjs.es.js";
const { DicomEventStream, EventStreamListener } = dcmjs.eventStream;

let tag = null, bot = null; const sizes = [];
const listener = new EventStreamListener({
  startElement(next, t, info) { tag = t; return next(t, info); },
  startBinary(next, opts) { if (tag === "7FE00010") bot = opts.basicOffsetTable; return next(opts); },
  binaryFragment(next, chunk) { if (tag === "7FE00010") sizes.push(chunk.byteLength); return next(chunk); }
});
await DicomEventStream.fromPart10Stream(
  fs.createReadStream("/tmp/dcmjs-examples-data/encapsulation-fragment-multiframe.dcm")
).process(listener);
console.log("PixelData: BOT", bot, "| fragments:", sizes);
// PixelData: BOT [ 0, 34348 ] | fragments: [ 20480, 13852, 20480, 14122 ]
```

Two frames carried as four fragments, mapped by the offset table — exactly as
they sit on the wire.

## DICOMweb JSON in, DICOMweb JSON out

The event stream is source-agnostic: DICOMweb JSON (the DICOM JSON model) is
just another source, and another sink. One buffer, two shapes, and back
again:

```js
import fs from "node:fs";
import dcmjs from "./build/dcmjs.es.js";
const { DicomEventStream } = dcmjs.eventStream;

const bytes = fs.readFileSync("/tmp/dcmjs-examples-data/multiframe-ultrasound.dcm").buffer;
const json = await DicomEventStream.fromPart10Stream(bytes).toDicomWebJson();
console.log(JSON.stringify(json["00080060"]));
// {"vr":"CS","Value":["US"]}

// and back: DICOMweb JSON -> Part 10 bytes (Part10Writer under the hood)
const part10 = await DicomEventStream.fromDicomWebJson(json).toPart10();
const again = await DicomEventStream.fromPart10Stream(part10).toNaturalized();
console.log(again.NumberOfFrames, "frames of", again.Modality);
// 29 frames of US
```

`fromDicomWebJson` handles both binary forms per the standard: `InlineBinary`
is decoded, `BulkDataURI` surfaces as a bulk-data reference event — nothing
is fetched behind your back.

## Whole-slide imaging over live DICOMweb

The same source pointed at a real server. This study is a digital-pathology
slide pyramid (Modality `SM`) on the public OHIF demo server — the base level
alone is 21,710 frames tiling a 40,001 × 31,019 pixel matrix, and its
metadata naturalizes in milliseconds because pixel data stays behind
`BulkDataURI` references:

```js
import dcmjs from "./build/dcmjs.es.js";
const { DicomEventStream } = dcmjs.eventStream;

const base = "https://d14fa38qiwhyfd.cloudfront.net/dicomweb";
const study = "2.25.103659964951665749659160840573802789777";
const series = "1.3.6.1.4.1.5962.99.1.1131469279.179373488.1637514041823.2.0";

const res = await fetch(`${base}/studies/${study}/series/${series}/metadata`);
const instances = await res.json();
for (const instance of instances) {
  const ds = await DicomEventStream.fromDicomWebJson(instance)
    .toNaturalized({ cardinalityViolationPolicy: "preserve" });
  console.log(ds.Modality, "frames:", ds.NumberOfFrames,
    "matrix:", ds.TotalPixelMatrixColumns + "x" + ds.TotalPixelMatrixRows);
}
// SM frames: 21710 matrix: 40001x31019
// SM frames: 1 matrix: 990x768
// SM frames: 99 matrix: 2500x1938
// SM frames: 1386 matrix: 10000x7754
```

(The `cardinalityViolationPolicy` option is the naturalizer's §15.2 knob —
this dataset declares `DimensionIndexPointer` with more values than its VM,
and the default policy would warn about it on every instance. `preserve`
keeps the values and stays quiet; `throw` refuses; the default
`warnAndPreserve` tells you.)

---

## A test drive for reviewers

Everything above, runnable in about two minutes. Fetch the data (all real
files from the [dcmjs-org/data](https://github.com/dcmjs-org/data) releases):

```bash
mkdir -p /tmp/dcmjs-examples-data && cd /tmp/dcmjs-examples-data
base=https://github.com/dcmjs-org/data/releases/download
curl -sLO $base/binary-parsing-stressors/multiframe-ultrasound.dcm
curl -sLO $base/binary-parsing-stressors/large-private-tags.dcm
curl -sLO $base/encapsulation/encapsulation-fragment-multiframe.dcm
curl -sLO $base/deflate-transfer-syntax/deflate_tests.zip
curl -sLO $base/us-multiframe-cine/us-cine.zip
unzip -o -q deflate_tests.zip -d deflate && unzip -o -q us-cine.zip -d us-cine
```

Then from the repo root (`pnpm install && pnpm run build` first), save any
snippet above as a `.mjs` file and run it. The two below are the ones that
show the streaming story end to end.

### Make yourself a stress file

There is a 4 MB ultrasound cine in that download. This inflates it to 211 MB
by replaying its event stream through a filter that re-emits every
pixel-data fragment 48 times — event-stream surgery on the way to a
`StreamingPart10Writer`, still nothing whole-file in memory:

```js
// make-big.mjs
import fs from "node:fs";
import dcmjs from "./build/dcmjs.es.js";
const { DicomEventStream, StreamingPart10Writer } = dcmjs.eventStream;

const out = fs.createWriteStream("/tmp/dcmjs-examples-data/big-cine.dcm");
let pending = Promise.resolve();
const writer = new StreamingPart10Writer(
  { onChunk(c) { if (!out.write(c)) pending = new Promise(r => out.once("drain", r)); } },
  { binaryFragment(next, chunk) { for (let i = 0; i < 48; i++) next(chunk); } }
);
writer.setDrain(() => pending);

await DicomEventStream.fromPart10Stream(
  fs.createReadStream("/tmp/dcmjs-examples-data/us-cine/us-cine.dcm")
).process(writer);
out.end();
console.log("wrote big-cine.dcm:", (writer.bytesWritten / 1e6).toFixed(0), "MB");
// wrote big-cine.dcm: 211 MB
```

### Prove the memory stays flat

Now read that file back, sampling live `ArrayBuffer` memory as it streams
(the `global.gc()` before each sample makes the number *live* memory, not
uncollected garbage — hence the `--expose-gc` flag):

```js
// bounded-read.mjs
import fs from "node:fs";
import dcmjs from "./build/dcmjs.es.js";
const { DicomEventStream, EventStreamListener } = dcmjs.eventStream;

const file = "/tmp/dcmjs-examples-data/big-cine.dcm";
let peak = 0, fragments = 0, payload = 0;
const sample = () => { global.gc(); peak = Math.max(peak, process.memoryUsage().arrayBuffers); };

const listener = new EventStreamListener({
  binaryFragment(next, chunk) {
    payload += chunk.byteLength;
    if (++fragments % 100 === 0) sample();
    return next(chunk);
  }
});

await DicomEventStream.fromPart10Stream(
  fs.createReadStream(file, { highWaterMark: 1024 * 1024 })
).process(listener);
sample();

console.log(`file: ${(fs.statSync(file).size / 1e6).toFixed(0)} MB,`,
  `pixel payload seen: ${(payload / 1e6).toFixed(0)} MB in ${fragments} fragments,`,
  `peak live ArrayBuffer memory: ${(peak / 1e6).toFixed(1)} MB`);
```

```bash
node --expose-gc bounded-read.mjs
# file: 211 MB, pixel payload seen: 211 MB in 5617 fragments, peak live ArrayBuffer memory: 15.6 MB
```

For contrast, the eager path on the same file — `readFileSync` +
`DicomMessage.readFile` — sits at **379 MB** of live `ArrayBuffer` memory
(the input buffer plus every materialized fragment). 15.6 MB versus 379 MB
on the same 211 MB file is the whole streaming story in one line, and the
streaming number does not grow with the file: it is bounded by the read
stream's chunk size and the largest single element, never the file. The
21.8 GB Supplement 225 video fixture the engine was developed against goes
through this same path; it just doesn't fit in a GitHub release.

One honest caveat: `--max-old-space-size` is *not* the right way to observe
any of this — DICOM payloads live in `ArrayBuffer`s, which Node accounts as
external memory outside the V8 heap cap, so both paths survive a small heap
flag. `process.memoryUsage().arrayBuffers` after a forced GC is the metric
that tells the truth.

### The WSI drive-by

The whole-slide recipe above needs no downloads at all — it runs against the
public OHIF demo DICOMweb at `d14fa38qiwhyfd.cloudfront.net` (verified
serving 200s at the time of writing). Save it as `wsi.mjs`, run `node
wsi.mjs`, and you naturalize a four-level pathology pyramid — 21,710 frames
at the base — from live server metadata in under a second.
