---
title: Streaming (AsyncDicomReader + fromPart10Stream)
---

This page covers both streaming paths in dcmjs:

- **`fromPart10Stream`** — the new chunked event-stream source (slice K, complete).
  Bounded-memory, backpressured, 15-verb `EventStreamListener` vocabulary. Use
  this for new code that needs incremental parsing.
- **`AsyncDicomReader`** — the legacy chunk-feed reader with 4-verb listener
  vocabulary. Still the right tool for code that needs per-frame pixel-data
  delivery or the `DicomMetadataListener` API. Re-platform onto `fromPart10Stream`
  is deferred to 1.x.

---

## `fromPart10Stream` — chunked streaming source (slice K, DONE)

`fromPart10Stream` (exported from `dcmjs.eventStream`) parses a DICOM Part 10
byte source incrementally into the 15-verb `EventStreamListener` vocabulary,
without buffering the full file.

```js
import { fromPart10Stream } from "dcmjs/src/eventStream/fromPart10Stream.js";
import { EventStreamListener } from "dcmjs/src/eventStream/EventStreamListener.js";

class MyListener extends EventStreamListener {
    _baseStartElement(tag, info) { /* ... */ }
    _baseValue(v, opts) { /* ... */ }
    _baseEndElement() { /* ... */ }
    // ... other vocabulary methods
}

const listener = new MyListener();
await fromPart10Stream(asyncIterableChunks, listener);
```

### Accepted inputs

| Input type | Notes |
|---|---|
| `ArrayBuffer` / `Uint8Array` | Degenerate single-chunk; re-runnable |
| `AsyncIterable<Uint8Array\|ArrayBuffer>` | Async generators, Node.js readable streams in object mode |
| WHATWG `ReadableStream` | Adapted via `Symbol.asyncIterator` (Node ≥ 16.14) or reader-loop fallback |

`noCopy` is intentionally not accepted (decision D-E): zero-copy views alias
chunk memory that `consume()` releases mid-parse. Use the buffered `fromPart10`
when zero-copy is required.

### Architecture

```
                 ┌─────────────────────────────────────────────────────┐
  async chunks → │ ReadBufferStream (clearBuffers, SplitDataView)       │
                 │   feed loop (unawaited)      stream.setComplete()   │
                 └──────────────┬──────────────────────────────────────┘
                                │ ensureAvailable / consume
                 ┌──────────────▼──────────────────────────────────────┐
  Phase 1:       │ Preamble detection                                   │
                 │  "DICM" at 128 → normal Part 10 (skip to 132)       │
                 │  group 0x0002 at 0 → PART10_NO_PREAMBLE             │
                 │  neither → raw-dataset fallback (buffered fromPart10)│
                 └──────────────┬──────────────────────────────────────┘
                                │
                 ┌──────────────▼──────────────────────────────────────┐
  Phase 2:       │ Incremental FMI parse (always EXPLICIT_LITTLE_ENDIAN)│
                 │  element-by-element decode via decodeCore            │
                 │  captures TransferSyntaxUID (0002,0010)              │
                 │  collects fmiElements[] for deferred emission        │
                 └──────────────┬──────────────────────────────────────┘
                                │
                 ┌──────────────▼──────────────────────────────────────┐
  Phase 3:       │ Emit FMI events (now that TS is known)               │
                 │  listener.startDataSet({ transferSyntaxUID })        │
                 │  listener.startFileMetaInformation()                 │
                 │  per element: startElement/value.../endElement       │
                 │  listener.endFileMetaInformation()                   │
                 └──────────────┬──────────────────────────────────────┘
                                │
                 ┌──────────────▼──────────────────────────────────────┐
  Phase 4:       │ Body element loop (fully incremental)                │
                 │                                                       │
                 │  parseOneElement() classifies each element:          │
                 │   ├─ defined-length leaf → emitDefinedLeaf           │
                 │   │   decodeCore.decodeElementValues → value() calls │
                 │   ├─ SQ (defined or undefined length) → emitSequence │
                 │   │   parseSqItems / parseItemElements (recursive)   │
                 │   │   undefined-length: EventBuffer backfills span   │
                 │   ├─ 7FE00010 undefined-length → emitEncapsulated    │
                 │   │   streams fragments; per-fragment consume()       │
                 │   └─ undefined-length non-SQ leaf → emitUndefinedLeaf│
                 │       skipUndefinedSequence → decodeWithEagerReadTag │
                 │                                                       │
                 │  After each top-level element: bsrc.consume(offset)  │
                 └──────────────┬──────────────────────────────────────┘
                                │
                 ┌──────────────▼──────────────────────────────────────┐
  Phase 5        │ listener.endDataSet()                                │
  (deflate K5):  │                                                       │
                 │  rawTransferSyntaxUID == DEFLATED_EXPLICIT_LE?       │
                 │   YES → pako.Inflate relay coroutine (unawaited)     │
                 │         feeds inflated chunks into bodyStream        │
                 │         body loop reads from bodyStream (zero-based) │
                 │   NO  → body loop reads from stream (raw)            │
                 └──────────────────────────────────────────────────────┘
```

**Decision D-C: ported loop, not parser adaptation.** The body element loop is
a self-contained, `await`-at-boundaries loop (like `AsyncDicomReader`) rather
than an attempt to run the tokenizer (`packages/parser`) over an async stream.
The tokenizer assumes one contiguous buffer; adapting it to chunk lists would
require pervasive changes. The ported loop shares value decoding with the lazy
path via `decodeCore`.

### Bounded memory

Both `stream` (raw input) and `bodyStream` (inflated, deflate path only) are
created with `clearBuffers: true`. The body loop calls `bsrc.consume(bsrc.offset)`
after each top-level element, and `emitEncapsulated` calls `bsrc.consume(bsrc.offset)`
after each fragment. Peak retained memory is bounded by:

```
maxFragment + chunkSize + fixedFramingSlack  ≈  336 KB
```

for the encapsulated path (empirically verified by Gate 4 in `streamEquivalence.test.js`).

### Backpressure

`EventStreamListener.setDrain(fn)` installs a gate. `fromPart10Stream` calls
`listener.awaitDrain()` at:
- each top-level element boundary (body loop)
- each fragment in `emitEncapsulated`

The gate is promise-driven — no polling, no `setInterval`.

### Corpus equivalence

29 fixtures (ELE, ILE, EBE, deflate, encapsulated, multi-frame) at four chunk
granularities (whole-file, 1024 bytes, 37 bytes, 1 byte) all produce the same
output as the buffered `fromPart10`. Two accepted, tested divergences exist:

**DELTA-A — encapsulated pixel data `startElement.length`:** `fromPart10Stream`
carries the on-wire `0xFFFFFFFF`; the buffered path carries a computed span.
All other events (including `startSequence`, `startItem`, values, and binary
fragments) are byte-identical for conformant input.

**DELTA-B — non-conformant input: undefined-length text VRs (UT/UC/UR):**
DICOM PS3.5 only permits undefined length for SQ elements, items, and
encapsulated pixel data. When a UT/UC/UR element carries length `0xFFFFFFFF`
(non-conformant), the two paths diverge deliberately:
- **Buffered `fromPart10`** — `readEncodedString` clamps the read to the buffer
  boundary, silently consuming all remaining bytes (including any FFFE,E00D
  delimiter and trailing elements) into the string value. Returns successfully
  with a garbage value; trailing elements are lost.
- **`fromPart10Stream`** — `emitUndefinedLeaf`'s `skipUndefinedSequence` sees
  the non-FFFE value bytes as malformed, stops at value-start, and the body
  loop re-parses those bytes as a DICOM element, producing a truncation throw.

The loud-failure behavior is **deliberate**: the stream fails noisily on
non-conformant data that the buffered path silently mishandles. This divergence
is empirically verified and pinned in K4 Test 22b of
`test/eventStream/fromPart10Stream.test.js`.

---

## `AsyncDicomReader` — legacy chunk-feed reader

`AsyncDicomReader` (exported as `dcmjs.async.AsyncDicomReader`) reads DICOM
from a stream of chunks instead of one contiguous buffer: it awaits data as
needed, frees consumed chunks, and delivers values to a listener as they are
parsed. Use it when the file does not fit comfortably in memory or arrives
incrementally (network, file streams).

:::caution Preliminary
The reader's own docblock says it best: the exact interface is still
preliminary and initially released for testing purposes. There is no support
for deflated streams (use [`DicomMessage.readFile`](../guides/deflate.md) for
those), and the architecture below is scheduled for a 1.x re-platform.
:::

### Usage

```js
const { AsyncDicomReader } = dcmjs.async;
const { DicomMetadataListener } = dcmjs.utilities;

const reader = new AsyncDicomReader();
const listener = new DicomMetadataListener();

// feed chunks: from a Node stream...
const readPromise = reader.stream.fromAsyncStream(fs.createReadStream(path));
// ...or manually: reader.stream.addBuffer(chunk); reader.stream.setComplete();

const { meta, dict } = await reader.readFile({ listener });
listener.information.transferSyntaxUid; // tracked while parsing
```

- **Chunked input.** The reader's `ReadBufferStream` accepts buffers as they
  arrive (`addBuffer`, `fromAsyncStream`) over a `SplitDataView` — a DataView
  facade across a list of chunks. `await stream.ensureAvailable(n)` suspends
  parsing until `n` bytes exist (or the stream is marked complete), and
  `stream.consume()` drops references to fully read chunks so memory stays
  bounded.
- **Listener model.** Parsing emits structural events to a listener
  (`startObject`/`value`/`pop`, `addTag`), letting applications transform or
  discard data on the fly. `DicomMetadataListener` additionally tracks a
  default set of top-level attributes (transfer syntax, UIDs, Rows/Columns,
  BitsAllocated, ...) in `listener.information`, which the reader itself uses
  for frame geometry. Listeners can request raw delivery per tag
  (`expectsRaw`) and apply backpressure via `awaitDrain`.
- **`maxFragmentSize`** (constructor option, default 128 MB) caps the size of
  any single delivered buffer: larger values and pixel-data frames are split
  into multiple `listener.value()` calls.
- **Part 10 and raw detection.** `readPreamble` handles three stream shapes:
  a full Part 10 file (preamble + `DICM`), Part 10 without preamble (stream
  starts with group `0002` meta — the `PART10_NO_PREAMBLE` sentinel), and raw
  datasets with no meta at all, where `detectRawEncoding` sniffs implicit
  vs. explicit little endian from the first tag's VR bytes and validates that
  implicit lengths are even.
- **Pixel data.** Encapsulated pixel data is reassembled into frames using
  the Basic Offset Table when present (with video transfer syntaxes treated
  as a single stream), uncompressed pixel data is split into frames from the
  tracked geometry, and single-bit (`bitsAllocated === 1`) multi-frame data is
  unpacked per frame.
- **Charset handling** mirrors the synchronous path: (0008,0005) swaps the
  stream decoder via `encodingMapping` and the stored value is normalized to
  `["ISO_IR 192"]` (see [Character sets](../guides/character-sets.md)).

### Current architecture: not yet on fromPart10Stream

Unlike `fromPart10Stream` (which emits the 15-verb `EventStreamListener`
vocabulary), `AsyncDicomReader` still runs its **own** header and element loop
with the 4-verb `DicomMetadataListener` vocabulary (`addTag` / `startObject` /
`value` / `pop`):

- `readTagHeader` duplicates the eager `DicomMessage._readTag` VR/length
  rules (with one streaming extra: implicit `xs` tags resolve signedness from
  the tracked `pixelRepresentation`);
- the meta group is still read by delegating to the eager
  `DicomMessage._read` — which is the main reason the eager read loop
  survives in the 1.0-beta codebase;
- every primitive read goes through `SplitDataView.findView`, the
  chunk-spanning DataView lookup.

This is deliberate: the reader is self-contained and keeps working as-is.

### Scoped 1.0 fixes (landed)

Three targeted fixes landed for 1.0 without changing the architecture:

- **`readUint16Array` off-by-one** in `BufferStream` — the loop indexed from
  1, so the result array's first slot was never filled and the last decoded
  value fell off the end; fixed and covered by tests.
- **Shared `TextDecoder`/`TextEncoder` singletons** — streams are created per
  sequence item, fragment, and element, and constructing codecs per stream was
  measurable overhead; both are stateless as used, so module-level defaults
  are shared (`setDecoder` still installs per-stream decoders when the
  charset changes).
- **Cached-chunk fast path in `SplitDataView`** — `findStart` remembers the
  last chunk hit and checks it (and its successor) before falling back to the
  linear scan, which makes sequential streaming reads O(1) per primitive
  instead of O(chunks).

### Why re-platforming onto `fromPart10Stream` is non-trivial (1.x item)

The K7 assessment (task-K7-report.md) established two specific breakage points
that prevent a thin adapter:

1. **Uncompressed pixel data frame splitting.** `fromPart10Stream` delivers
   pixel data as a single `startBinary / binaryFragment(wholeBuffer) / endBinary`
   event sequence (via `emitValues`). `AsyncDicomReader.readUncompressed()`
   splits the blob into per-frame arrays using `listener.information.numberOfFrames`,
   `rows`, `cols`, and `bitsAllocated`. The test contract expects
   `dict[PixelData].Value = [[ArrayBuffer]]`. An adapter would need to buffer
   the full pixel blob and re-split it — not a thin shim.

2. **Compressed frame assembly.** `fromPart10Stream.emitEncapsulated()` streams
   fragments flat. `AsyncDicomReader.readCompressed()` assembles frames from
   fragments using Basic Offset Table offsets. An adapter would need to
   re-implement that assembly.

The re-platform is left for 1.x, with options including (a) changing
`fromPart10Stream` to emit per-frame events for pixel data, (b) adding a
frame-assembly adapter that wraps `fromPart10Stream` output, or (c) re-writing
`AsyncDicomReader` to use `fromPart10Stream` with a more comprehensive shim
that accepts the additional complexity.
