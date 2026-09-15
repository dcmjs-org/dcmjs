---
title: The lazy read core
---

:::danger Deprecated — removal scheduled
The lazy read core is **deprecated as of 2026-08-02** (stakeholder
decision: the event stream delivers ~90% of the benefit; the remaining
byte-identity/passthrough 10% does not justify a second buffered read
engine). `DicomMessage.readFile` defaults to the **eager** core again;
`core: "lazy"` / `DCMJS_CORE=lazy` remain as a one-release escape hatch
and emit a one-time warning. `src/lazy/LazyDicomReader.js` and the
passthrough write path will be removed in the next release.
:::

`DicomMessage.readFile` can be backed by the lazy read core in
`src/lazy/LazyDicomReader.js` (deprecated, opt-in). This page explains how
it works mechanically. For the user-facing API see
[Reading DICOM](../guides/reading.md); for the byte-offset layer
underneath see [The parser package](./parser-package.md).

## The pipeline

```js
parseDicom(byteArray, parserOptions)  // @dcmjs/parser: offsets only, one pass
  -> wrap                             // O(#elements), no value decoding
  -> DicomDict { meta, dict }         // entries materialize on first access
```

The tokenizer pass produces elements that record byte spans
(`startOffset`, `dataOffset`, `length`, `endOffset`) but no decoded
values. The wrap step is a single loop over the element map: elements
whose `tagValue >>> 16 === 0x0002` go to `DicomDict.meta`, everything
else to `DicomDict.dict`, each as a lazy entry keyed by the clean
uppercase tag string (`'x00080005'` becomes `'00080005'`).

Only two elements are resolved eagerly at wrap time, because everything
else depends on them: the transfer syntax (`0002,0010`), which fixes
endianness and implicit/explicit framing for the whole body, and
`SpecificCharacterSet` (`0008,0005`), which fixes the text decoder (see
below).

## Getter-backed entries

Each lazy entry has the same observable shape as a 0.x eager entry —
`{ vr, Value, _rawValue }` wrapped by
`ValueRepresentation.addTagAccessors` — but `Value` and `_rawValue` are
accessor properties (`createLazyEntry` in `LazyDicomReader.js`):

- the **getter** materializes the element on first access and caches the
  result, so repeated access does no further work;
- the **setter** stores the assigned value and flips the entry's
  non-enumerable `_dirty` flag (plus a nested-dirt counter up the
  enclosing-sequence chain) — the seam the
  [passthrough writer](./writer.md) is built on.

Because laziness is getter-based, code that touches everything —
`JSON.stringify(dict)`, `naturalizeDataset`, deep iteration —
materializes everything and ends in the same state the eager reader
produced up front. There is no behavioral cliff, only deferred work.

## Materialization: windowed streams over the existing VR classes

The decode primitives — `resolveVrInstance`, `decodeElementValues`,
`resolveCharacterSet`, `decodeWithEagerReadTag`, `seedReadContext` and helpers —
live in `src/core/decodeCore.js` (extracted in slice J). The lazy reader and
`fromPart10` both import from that module; see the [event-stream
architecture](./event-stream.md#shared-decode-core) page for the `window`/`policy`
contract. The VR classes were not rewritten. `ReadBufferStream` supports
`{ start, stop }` windows over a buffer, so materializing an element is
(`materializeElement`):

```js
const stream = new ReadBufferStream(ctx.arrayBuffer, littleEndian, {
    start: baseOffset + el.dataOffset,
    stop: baseOffset + el.dataOffset + el.length
});
stream.setDecoder(ctx.decoder); // dataset/item charset
vr.read(stream, el.length, syntax, { forceStoreRaw: ctx.forceStoreRaw });
```

— exactly the `vr.read` call the eager `DicomMessage._readTag` made,
followed by a verbatim replication of its value shaping (VM splitting on
the backslash delimiter, binary multi-value chunking, the
single-VR/array quirks). The result `{ values, rawValues }` is cached on
the entry. One small stream allocation per first access is the cost of
this correctness-first bridge.

### VR resolution

For explicit syntaxes the tokenizer already read the VR bytes. Two cases
need the dictionary (`resolveVrInstance`):

- **UN with a known dictionary VR**: re-parsed as the dictionary VR via
  `ValueRepresentation.parseUnknownVr` (the 0.x `ParsedUnknownValue`
  behavior, kept for read-result equivalence).
- **Implicit VR files**: the tokenizer takes a `vrCallback` and the lazy
  core injects dcmjs's dictionary lookup into it, so elements are framed
  with the same VR resolution the eager reader used. The parser package
  itself stays dictionary-free; unknown tags fall back to the tokenizer's
  item-tag peek heuristic, then to `_readTag`'s rules (undefined length
  becomes SQ, pixel data becomes OW, private creators become LO, else UN).

### Character sets: resolved at wrap time

The eager reader swapped the stream decoder mid-scan when it passed
`0008,0005`. There is no scan in the lazy model, so the decoder is
resolved **once per dataset** at wrap time (`resolveCharacterSet`): read
the tiny element with the default latin decoder, map it through
`encodingMapping`, build the `TextDecoder`, and hand it to every
materialization window. The stored value is rewritten to
`["ISO_IR 192"]` while `_rawValue` keeps the original — the 0.x
normalize-to-UTF-8-on-read quirk, kept deliberately.

Sequence items get **per-item contexts**: an item carrying its own
`0008,0005` resolves its own decoder, inherited by its children unless
overridden (`wrapSequenceItem`). This actually exceeds the 0.x reader,
which supported only a single charset per file.

### Sequences: structural wrapping, no byte rescans

A plain SQ element never goes through the 0.x scan-rewind sequence
reader. The tokenizer has already parsed `el.items[]` (each item holding
its own element map), so `entry.Value` is built structurally
(`materializeSequence`): each item becomes a dict of lazy entries via
`wrapSequenceItem`, recursing into nested sequences. Empty items are
skipped, matching eager output. No bytes are rescanned; the recursion is
over the already-built element tree.

### Encapsulated pixel data: frames from fragment indexes

Encapsulated pixel data elements carry the tokenizer's `fragments` and
`basicOffsetTable` indexes. `materializeEncapsulatedPixelData` assembles
frames directly from them: with a BOT, fragments are grouped into
`[BOT[i], BOT[i+1])` windows (single-fragment frames are sliced
directly, multi-fragment frames merged); without a BOT, one frame per
fragment — matching the eager reader's existing behavior. No byte
scanning, no re-walk of item headers.

### Narrow fallback for rare shapes

A few element shapes (undefined-length UN parsed as an implicit
sequence, `ParsedUnknownValue` with undefined length, defined-length
private SQs the tokenizer treated as opaque, BOT entries that do not
land on fragment boundaries) are delegated to the exact eager code by
re-reading just that element's span `[startOffset, endOffset)` through
`DicomMessage._readTag` (`materializeWithEagerReadTag`) — byte-equivalent
values *and* errors by construction.

## The whole-file eager fallback

If the tokenizer rejects the stream outright — truncated files, declared
lengths overrunning the buffer, missing part-10 plumbing — the lazy core
delegates the **entire read** to the eager core with the caller's
original buffer and options (`readFileWithEagerCore`). The same happens
when the recorded meta group length does not line up with the
tokenizer's meta/body boundary, or when the transfer syntax element is
missing: in those corners the eager reader's exact behavior (including
its errors and its `ignoreErrors` recovery points) is reproduced by
running it. Dicts from this fallback carry no lazy writer context, so the
writer re-encodes them fully.

## The eager core as escape hatch

The historical eager read loop still exists behind a switch
(`src/DicomMessage.js`):

```js
// per call
DicomMessage.readFile(buffer, { core: "eager" });
// or globally
// DCMJS_CORE=eager node app.js
```

`DicomMessage.defaultCore` is `"lazy"` unless the `DCMJS_CORE`
environment variable says otherwise.

:::warning
The eager core is a beta-soak escape hatch, not a supported long-term
mode. It is slated for deletion in 1.x once the async reader is
re-platformed onto the tokenizer — see the
[roadmap](../development/roadmap.md) and
[Streaming](./streaming.md).
:::

## Documented divergences from the 0.x eager reader

The lazy core is equivalence-tested against the eager core
(`test/lazy-equivalence.test.js`, plus the hardening suites), but three
divergences are intentional and pinned by tests
(`test/lazy-hardening.test.js`; they are documented in the
`LazyDicomReader.js` module docblock):

1. **Error timing.** With `ignoreErrors: false`, an element whose bytes
   fail to materialize (an unsupported in-item character set, garbage in
   an encapsulated fragment stream) made the eager reader throw *during*
   `readFile`. The lazy core returns the dict and throws the
   eager-equivalent error at **first access** of that entry's
   `Value`/`_rawValue`.
2. **`ignoreErrors: true` yields more data.** Eager caught such errors
   mid-scan and returned a dict **truncated** at the failing element —
   everything at and after it was lost. Lazy returns the **full** dict
   and resolves just the failing entry to `undefined`, logging one
   warning per entry. Strictly more informative.
3. **Charset scope approximations.** The decoder applies per dataset and
   per sequence item, not per stream position. For conformant files —
   where `0008,0005` precedes every encoded string — the results are
   indistinguishable; only non-conformant element ordering can diverge.
   In-item charsets are handled with the same warn-and-continue policy
   eager used for a bad top-level charset under `ignoreErrors`, instead
   of truncating.

See also [Character sets](../guides/character-sets.md) and
[Migration from 0.x](../migration/from-0x.md).
