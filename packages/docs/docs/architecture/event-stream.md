---
title: Event-stream architecture
---

# Event-stream architecture

The event-stream layer (`dcmjs.eventStream`) is the canonical transformation model
for DICOM metadata. It separates four concerns so that readers, writers,
naturalizers, validators, and anonymizers all compose on one contract.

For the practical API and examples, see
[Event streams](../guides/event-streams.md). This page covers the model.

## Four layers

```
Source representation   →   Event stream   →   Listener / writer   →   Result
   (bytes, dict, JSON)       (the contract)     (a stream consumer)     (object/JSON/bytes)
```

1. **Source representations** — inputs that can generate events: Part 10 bytes
   (`fromPart10`), a parsed dcmjs dataset (`fromDataSet`), or DICOMweb JSON
   (`fromDicomWebJson`). Sources do not share an in-memory model.
2. **Event stream** — the single canonical interchange. Every reader produces it
   and every writer consumes it, so equivalent metadata yields equivalent events
   regardless of origin.
3. **Listeners and writers** — consumers of the stream. They may materialize
   objects (the naturalized listener), serialize output (the DICOMweb JSON and
   Part 10 writers), validate, or transform. Custom listeners are first-class.
4. **Retained representation** — the naturalized object is the preferred
   application-facing model. The event stream itself is not retained.

## The contract

The contract is a **hybrid**: a synchronous push core (a listener whose methods
are called as the stream is walked) with an async-iterator adapter layered on top.
The push core keeps the hot path allocation-free; the adapter offers `for await`
ergonomics.

The vocabulary:

```
Lifecycle   startDataSet / endDataSet
            startFileMetaInformation / endFileMetaInformation
Structural  startElement / endElement
            startSequence / endSequence
            startItem / endItem
            value(v, { index, rawValue? })
Binary      bulkDataReference                       (a reference, nothing fetched)
            startBinary / binaryFragment / endBinary (a fragment sub-stream)
```

### Invariants

- **Loss preservation.** A generator emits every observed value and every observed
  item, regardless of declared VM. Cardinality enforcement is a *listener* policy,
  never the stream's.
- **Well-formed nesting.** Every `start*` is balanced by its `end*`, in source
  order.
- **Transport-only binary.** Binary is carried as a fragment sub-stream or a
  `bulkDataReference`; functions and large buffers are never smuggled through as
  payloads. Inline binary is decoded to bytes; bulk references stay lazy.
- **Out-of-band diagnostics.** The stream stays purely loss-preserving; warnings
  (e.g. cardinality violations) belong to listeners.
- **Optional `sourceSpan`.** Structural events may carry source byte offsets for
  writers that want them; consumers that don't, ignore them.

Synchronous structural/value callbacks keep allocation low; backpressure is
applied out of band (`setDrain`/`awaitDrain`) and awaited only at defined
checkpoints — top-level element boundaries and binary-fragment emission.

## Shared decode core

`fromPart10` and the lazy reader (`readFileLazy`) share a common decode module,
`src/core/decodeCore.js`. Its contract is two read-only inputs:

- **window** — `{arrayBuffer, baseOffset, syntax, littleEndian, implicit, decoder}`:
  a fully-resolved byte region. `fromPart10` and `readFileLazy` each construct a
  *meta window* (original buffer, explicit LE) and a *body window* (post-inflate body,
  negotiated transfer syntax) and pass the appropriate one to each decode call.
- **policy** — `{forceStoreRaw, noCopy, ignoreErrors}`: decode options threaded from
  the caller's options.

The module is stateless; it exports `resolveVrInstance`, `decodeElementValues`,
`resolveCharacterSet`, `decodeWithEagerReadTag`, `seedReadContext`, and related helpers.
`fromPart10` handles deflate and undefined-length elements natively through this shared
core — it no longer whole-file delegates to the lazy reader. `fromPart10Stream` (slice K)
will consume the same `window`/`policy` contract.

## Relationship to the read/write cores

The event layer sits *on top of* the existing cores; it does not replace them:

- `fromPart10` uses `decodeCore` directly (see above); `fromDataSet` walks an
  already-decoded dataset tree (typically from `readFileLazy`, which also consumes
  `decodeCore`) and the [parser package](./parser-package.md).
- The Part 10 writer layers over the canonical [writer](./writer.md)
  (`DicomDict.write`). Byte-identical Part 10 round-tripping (incl. verbatim
  compressed pixel data) is a deliberate non-goal of the event/naturalized path
  and remains served by the lazy read + passthrough writer.

## Streaming source gates (slice K)

`fromPart10Stream` — the incremental, chunk-fed streaming source — is held to
the same contract as `fromPart10` by a formal gate suite
(`test/eventStream/streamEquivalence.test.js`):

- **Corpus × chunking equivalence.** Every fixture is streamed at chunk sizes
  1, 37, 1024, and whole-file; the `CollectorListener` result must be deep-equal
  to the buffered `fromPart10` result. One-byte chunks are the ultimate
  byte-boundary torture test. Known-reject fixtures (e.g. `sample-op.lei`) must
  reject consistently across both sources.
- **Raw-event-level parity.** Five representative fixtures (plain ELE, explicit
  BE, implicit LE, deflate, encapsulated) are replayed through a
  `RecordingListener` and the full event sequence is compared verbatim between
  sources. The one documented delta is DELTA-A: encapsulated pixel-data
  `startElement.length` is `0xFFFFFFFF` (stream) vs a computed span (buffered);
  this is normalized by name in the gate and pinned in code.
- **Synthesized EBE SQ.** An in-test Explicit Big Endian file with a
  defined-length sequence validates that FFFE-family item/delimiter tags and their
  lengths are read in the body transfer-syntax byte order (big-endian for EBE),
  matching the buffered `fromPart10` behavior (Tag.readTag → readUint16 which
  honors `isLittleEndian`).
- **Bounded memory — encapsulated.** A 24 × 256 KB synthetic encapsulated file
  is streamed with a drain gate; peak retained bytes must stay below
  `(1 fragment + 1 chunk + slack)` and final retention must approach zero.
- **Bounded memory — deflate.** A synthetic deflate body is streamed; both the
  inflated `bodyStream` and the raw `stream` peaks must stay bounded.
- **Backpressure.** A controllable `drainBlocker` placed before `fromPart10Stream`
  starts proves that the body loop does not race ahead: no element N+2 event
  arrives while the drain is blocked after element N. Release resumes to
  completion without timeout.
- **Truncation — loud, not silent.** Seven truncation phases (mid-preamble,
  mid-FMI, mid-element-header, mid-value, mid-fragment, mid-deflate-stream, empty
  input) each reject with an error; none hang. A per-phase 5-second hang safety
  net is the backstop.

## Source-agnostic equivalence

Because all sources emit the same contract, the naturalized object is identical
across origins. This is verified across the whole fixture corpus: each fixture is
naturalized from raw bytes, from a parsed dict, and from DICOMweb JSON
(round-tripped through the writer), and the three results must match.
