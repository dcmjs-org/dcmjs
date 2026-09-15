---
title: Event streams (sources, sinks, and the naturalized model)
---

# Event streams

The `dcmjs.eventStream` namespace is a single, source-agnostic pipeline for DICOM
metadata. Any **source** (Part 10 bytes, a parsed dcmjs dataset, or DICOMweb JSON)
is turned into one canonical **event stream**, and any **sink** consumes that
stream to produce a result — a naturalized application object, DICOMweb JSON, a
Part 10 file, or a tag-keyed dataset.

```
        SOURCES                      CONTRACT                       SINKS
  fromPart10  (bytes) ─┐                                     ┌─ toNaturalized   (app object)
  fromDataSet (dict)  ─┼──▶  event-stream contract  ─────────┼─ toDicomWebJson  (DICOMweb JSON)
  fromDicomWebJson ────┘     (push core + async iterator)    ├─ toPart10        (DICOM file)
                                                             └─ toDataSet       (tag dict)
```

Because every source produces the same contract, **equivalent metadata produces
equivalent results regardless of origin** — the same DICOM data naturalizes to an
identical object whether it arrived as Part 10 bytes, a dict, or DICOMweb JSON.

## Quick start

```js
import dcmjs from "dcmjs";
const { DicomEventStream } = dcmjs.eventStream;

// bytes -> naturalized application object
const metadata = await DicomEventStream.fromPart10(arrayBuffer).toNaturalized();
metadata.PatientName.Alphabetic; // "Doe^Jane"
metadata.PatientID;              // "12345"

// DICOMweb JSON -> DICOM Part 10 file
const file = await DicomEventStream.fromDicomWebJson(json).toPart10();

// auto-detect the source kind
const meta2 = await DicomEventStream.from(anyOfTheAbove).toNaturalized();
```

## `DicomEventStream`

A `DicomEventStream` wraps a **re-runnable** source, so one stream can drive
several sinks.

### Sources (static factories)

| Factory | Source |
|---|---|
| `DicomEventStream.fromPart10(buffer, options?)` | a Part 10 `ArrayBuffer`/typed array; `options` are `DicomMessage.readFile`-style |
| `DicomEventStream.fromDicomWebJson(json)` | a DICOM JSON model object (`{ "ggggeeee": { vr, Value } }`) |
| `DicomEventStream.fromDataSet(dataset)` | a parsed dcmjs `{ meta, dict }` (e.g. from `DicomMessage.readFile`) |
| `DicomEventStream.from(source)` | auto-detects: bytes → Part 10, `{ dict }`/`{ meta }` → dataset, any other object → DICOM JSON |

### Sinks (instance methods)

| Method | Result |
|---|---|
| `await stream.toNaturalized(options?)` | the naturalized application object (see [The naturalized model](#the-naturalized-model)) |
| `await stream.toDicomWebJson()` | a DICOM JSON model object |
| `await stream.toPart10(writeOptions?)` | a Part 10 `ArrayBuffer` |
| `await stream.toDataSet()` | a tag-keyed `{ meta, dict }` tree |
| `await stream.process(listener)` | drive an arbitrary listener; resolves to the listener |
| `stream.asyncIterable(options?)` | an async-iterable of `{ type, args }` events |

The `§32` sink helpers `Naturalized.from(stream, options?)` and
`DicomWebJson.from(stream)` are thin aliases for `toNaturalized` / `toDicomWebJson`.

```js
const { DicomEventStream } = dcmjs.eventStream;

const source = DicomEventStream.fromPart10(arrayBuffer);
const app = await source.toNaturalized();   // re-runnable -
const json = await source.toDicomWebJson();  // drive it again for a second sink
```

### Streaming with `for await`

The push core is canonical, but an async-iterator adapter is available for
ergonomic consumption. Each event is `{ type, args }` where `type` is a vocabulary
method name.

```js
for await (const ev of DicomEventStream.fromPart10(buffer).asyncIterable()) {
    if (ev.type === "startElement") {
        const [tag, info] = ev.args; // info: { vr, length, ... }
    }
}
```

Backpressure is real: a slow consumer suspends the generator at defined
checkpoints once the internal queue exceeds `highWaterMark` (default 64).

## The naturalized model

`toNaturalized()` (the `NaturalizedListener` sink) builds the application-facing
object defined by the *Naturalized DICOM Metadata Behavior Specification*.

### Keyword keys and VM-driven cardinality

Keys are canonical DICOM keywords (`PatientName`, not `00100010`). The **shape** of
each value follows the attribute's declared VM, not how many values happen to be
present:

```js
metadata.PatientID;     // VM 1   -> scalar: "12345"
metadata.ImageType;     // VM 2-n -> always an array: ["ORIGINAL", "PRIMARY"]
metadata.OtherPatientIDs; // VM 1-n with one value -> still an array: ["A"]
```

| Declared VM | absent | present-empty | one value | many values |
|---|---|---|---|---|
| scalar (`1`, `0-1`) | omitted | `null` | scalar | array + violation (see policy) |
| multi (`1-n`, `2-n`, …) | omitted | `[]` | one-element array | array |

### Sequences

A single-item sequence is exposed as the item object itself (with a hidden
`length` of 1), so you can read straight through it; multi-item sequences are
arrays:

```js
// single item: read straight through
metadata.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness;
metadata.SharedFunctionalGroupsSequence.length; // 1

// many items: an array
metadata.PerFrameFunctionalGroupsSequence[42].FrameContentSequence;
```

A sequence's declared VM constrains how often the *attribute* appears, not its
item count — so multi-item sequences (e.g. `PerFrameFunctionalGroupsSequence`) are
normal, never cardinality violations.

### Person Names

PN values keep their DICOMweb `{ Alphabetic, Ideographic, Phonetic }` shape and
also stringify to the raw PN string:

```js
metadata.PatientName.Alphabetic;   // "Doe^Jane"
String(metadata.PatientName);      // "Doe^Jane"
```

### Private tags

Private attributes are grouped under a `"<slot>:<creator>"` key with
block-relative element keys, using the registered private name when known:

```js
metadata["10:SIEMENS CSA HEADER"];
// { originalTagOffset: 0x10, CSAImageHeaderInfo: ..., "99": ... }
```

### Binary and bulk data

```js
metadata.PixelData;                 // { InlineBinary: ArrayBuffer }  (assembled)
metadata.SomeBulkAttribute;         // { BulkDataURI: "https://.../bulk/1" } (not fetched)
```

### Precision

Numeric values that a JS number cannot reproduce (an over-precision `DS`) retain
their original source string; ordinary values stay numbers:

```js
metadata.SliceThickness; // "9007199254740993"  (would lose its last digit as a number)
```

### File Meta Information

Group `0002` is naturalized separately onto `listener.meta`:

```js
const l = new dcmjs.eventStream.NaturalizedListener();
await dcmjs.eventStream.fromPart10(buffer, l);
l.meta.TransferSyntaxUID; // "1.2.840.10008.1.2.1"
l.result.PatientID;       // the dataset body
```

### Cardinality-violation policy

When a non-sequence scalar attribute carries more values than its VM allows, the
listener applies a policy (default `warnAndPreserve`) and records the violation on
`listener.violations`:

```js
new dcmjs.eventStream.NaturalizedListener({
    cardinalityViolationPolicy: "warnAndPreserve"
    // preserve | discardExtra | warnAndPreserve | warnAndDiscardExtra |
    // recordAndPreserve | recordAndDiscardExtra | throw
});
```

## Writing

`toDicomWebJson()` and `toPart10()` serialize any source. `toPart10()` is a thin
layer over the canonical `DicomDict.write`, so it handles every VR,
undefined-length sequences, deflate, padding and group-length recomputation.

```js
// transcode bytes -> DICOMweb JSON
const json = await DicomEventStream.fromPart10(buffer).toDicomWebJson();

// build a DICOM file from DICOMweb JSON; pass write options through
const file = await DicomEventStream
    .fromDicomWebJson(json)
    .toPart10({ allowInvalidVRLength: true });
```

:::note Byte-identical round-trips
Re-emitting a Part 10 file byte-for-byte (including verbatim compressed pixel
data) is a non-goal of this pipeline — that is served by the lazy read + R4
passthrough writer (see [Writing & editing](./writing-and-editing.md)). The event
pipeline produces *semantically* faithful output.
:::

## Custom listeners and filters

Sinks are just listeners. Subclass `EventStreamListener` and override the
vocabulary methods, or compose **filters** — objects whose methods are
`method(next, ...args)` and call `next(...)` to continue the chain.

```js
const { EventStreamListener } = dcmjs.eventStream;

const tagLogger = {
    startElement(next, tag, info) {
        console.log("element", tag, info.vr);
        return next(tag, info);
    }
};

const listener = new EventStreamListener(tagLogger);
await dcmjs.eventStream.fromPart10(buffer, listener);
```

The contract vocabulary is: `startDataSet` / `endDataSet`,
`startFileMetaInformation` / `endFileMetaInformation`, `startElement` /
`endElement`, `startSequence` / `endSequence`, `startItem` / `endItem`,
`value(v, { index, rawValue? })`, `bulkDataReference`, and the binary sub-stream
`startBinary` / `binaryFragment` / `endBinary`. The full list is exported as
`dcmjs.eventStream.EVENT_STREAM_VOCABULARY`, and the contract version as
`CONTRACT_VERSION`.

## Generators (low-level)

The sink methods wrap generator functions you can call directly to drive a
listener. Each is `async` and resolves when the stream completes:

```js
const { fromPart10, fromDicomWebJson, fromDataSet, NaturalizedListener } =
    dcmjs.eventStream;

const listener = new NaturalizedListener();
await fromPart10(buffer, listener, options); // or fromDicomWebJson(json, listener)
listener.result; // the naturalized object
```

## API summary

`dcmjs.eventStream` exports:

- **Pipeline:** `DicomEventStream`, `Naturalized`, `DicomWebJson`
- **Generators (sources):** `fromPart10`, `fromDicomWebJson`, `fromDataSet`
- **Listeners (sinks):** `NaturalizedListener`, `DicomWebJsonWriter`, `Part10Writer`, `CollectorListener`
- **Contract:** `EventStreamListener`, `EVENT_STREAM_VOCABULARY`, `CONTRACT_VERSION`, `createEventAsyncIterable`

See [Architecture › Event-stream architecture](../architecture/event-stream.md)
for the conceptual model and invariants.
