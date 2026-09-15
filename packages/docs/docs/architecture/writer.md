---
title: The writer
---

`DicomDict.write()` produces a part-10 file: 128-byte preamble, `DICM`,
the meta group (explicit little endian, with a recomputed
`FileMetaInformationGroupLength`), then the body in the dict's transfer
syntax. Inside that unchanged shape, the 1.0 writer has two engines: a
**backpatching re-encoder** for entries that need encoding, and a
**passthrough fast path** that emits untouched entries as verbatim source
bytes. For the user-facing API see
[Writing and editing](../guides/writing-and-editing.md).

:::caution Byte-identity guarantee withdrawn
The passthrough fast path only operates on entries produced by the
**deprecated lazy read core** (they carry `_sourceSpan`/`_dirty`); it is
scheduled for removal with that core (2026-08-02 stakeholder decision).
With the default eager core, every write re-encodes: the output is always
**correct** DICOM, but not byte-for-byte identical to the source
(character-set labels normalize, padding may differ).
:::

## Re-encoding: direct writes with length backpatching

The 0.x writer encoded every element into its own temporary
`WriteBufferStream`, then copied it into the destination twice (once to
learn the length, once to concatenate). The 1.0 writer (`Tag.write` in
`src/Tag.js`) writes **directly into the destination stream** and fixes
the length afterward:

1. write the tag;
2. reserve the length field (2 bytes for short explicit VRs, 4 bytes for
   implicit and 32-bit-length VRs) and remember its offset;
3. let the VR class encode the value straight into the stream;
4. backpatch the reserved field with `writeUint16At` / `writeUint32At`
   (`src/BufferStream.js`), which write at an absolute offset without
   moving the stream position.

No per-element temporary stream, no double copy. SQ elements are written
with undefined length and delimiters, as before.

### The Big 16 (UN substitution) case

An explicit VR with a 2-byte length field cannot encode values of
`0x10000` bytes or more. Such values are written with a substituted
header — VR `UN` plus a 4-byte length — the "Big 16" layout. Because an
8-byte short header cannot be backpatched into the 12-byte Big 16 layout
after the fact, the writer decides **up front** (`src/Tag.js`):

- fixed-size binary VRs (FL, FD, SL, SS, UL, US, AT) know their exact
  encoded length from the value count, so the right header is emitted
  immediately, no backpatch needed;
- variable-length values are screened by `valueByteUpperBound`, a cheap,
  deliberately over-estimating bound. Only values that *might* overflow
  take the historical measured path (`_writeMeasured`): encode into a
  scratch stream, then emit the correct header and the measured bytes.
  Everything else streams directly with a backpatched 2-byte length, and
  an internal guard throws if the bound was ever wrong.

## The passthrough fast path

A lazy-read entry that was never edited still knows its exact on-disk
encoding: its `_sourceSpan` (`{ startOffset, endOffset, buffer }`) covers
the element header, value, items, and — for undefined-length sequences
and encapsulated pixel data — every item/sequence delimiter, the basic
offset table, and the fragments. For such entries the writer skips
encoding entirely (`DicomMessage.write` in `src/DicomMessage.js`):

```js
if (passthroughSource && isCleanForPassthrough(tagObject)) {
    const span = tagObject._sourceSpan;
    if (span.buffer === passthroughSource) {
        written += useStream.writeRawBytes(
            span.buffer.subarray(span.startOffset, span.endOffset)
        );
        return;
    }
}
// otherwise: re-encode via tag.write(...)
```

This copies whole SQ subtrees and the entire encapsulated PixelData run
in one `subarray` each — byte-identical, header to delimiter.

### Zero-copy windows

`writeRawBytes` (`src/BufferStream.js`) does not even copy large spans:
a span of **64 KB or more** appended at the end of the stream becomes a
read-only zero-copy *window* over the source buffer
(`SplitDataView.addZeroCopyWindow`, `src/SplitDataView.js`). The bytes
are referenced, not duplicated; smaller spans are copied with a single
`set`. Window chunks are marked read-only so a misdirected length
backpatch can never corrupt the caller's source buffer.

## Dirty tracking

Passthrough eligibility is decided by `isCleanForPassthrough`
(`src/lazy/LazyDicomReader.js`):

- Every lazy entry carries a non-enumerable `_dirty` flag, `false` until
  `Value` or `_rawValue` is **assigned**. The absence of `_dirty` means
  dirty: entries built by the eager core, by `DicomDict.upsertTag`, or by
  denaturalize always re-encode.
- Sequence entries also carry `_nestedDirtCount`: item entries hold a
  reference to their enclosing SQ entry, and any nested assignment bumps
  the counter on every ancestor — a deep edit dirties the whole subtree's
  top-level SQ element.
- **Structural-edit detection at write time.** Item dicts of a
  materialized SQ are plain objects, so `item["00080050"] = {...}`,
  `delete item["0020000E"]`, or pushing/splicing the item array bypasses
  every setter. `isCleanForPassthrough` therefore re-verifies a
  materialized SQ entry's structure against the parsed element
  (`sqStructureDiverged`): item count, per-item key sets, per-item entry
  ownership, recursively into materialized nested sequences. Any mismatch
  re-encodes. Never-materialized SQ entries cannot have been structurally
  edited and stay clean by construction; the check never materializes
  anything.

:::warning In-place mutation is undetectable
Dirtiness is assignment-based. `entry.Value.push(x)`,
`entry.Value[0] = x`, or mutating the bytes of a returned binary buffer
leaves the entry looking clean, and the passthrough writer would emit the
*original* bytes. Always edit through assignment
(`entry.Value = [...]`) or `DicomDict.upsertTag`. This is by design and
documented in the `LazyDicomReader.js` module docblock.
:::

## What disables passthrough

Passthrough applies per entry, but several conditions disable it for the
whole dict (`DicomMessage.write`):

- **No lazy context.** Only dicts produced by the lazy read path carry
  `_lazyWriteContext` (`{ sourceByteArray, sourceSyntax, charsetPassthroughSafe }`).
  Eager-fallback dicts, hand-built dicts, the meta group, and nested
  sequence items written through the re-encode path always re-encode.
- **Transfer syntax change.** Target and source must have the same
  *body* syntax. The deflated syntax counts as an explicit little endian
  body (the difference is only the stream-level deflate wrapper), so
  passthrough composes across deflated/ELE combinations. Converting, for
  example, implicit to explicit re-encodes every element.
- **Charset-unsafe source.** Passthrough requires the writer's UTF-8
  normalization to be byte-stable against the source: the original
  top-level `SpecificCharacterSet` must be absent, empty, ASCII
  (`ISO_IR 6` / single-valued `ISO 2022 IR 6`), or already UTF-8
  (`ISO_IR 192`). This gate is deliberately conservative — an
  `ISO_IR 100` (Latin-1) source always re-encodes today; a per-element
  ASCII fast path is possible 1.x work
  ([roadmap](../development/roadmap.md)).
- **Non-default encoding `writeOptions`.** An option that asks for bytes
  the source does not contain disables passthrough for the whole dict.
  Today that is `fragmentMultiframe: false`. Notably,
  `allowInvalidVRLength` does **not** disable it: that option gates
  write-time validation only, and byte-faithful passthrough legitimately
  preserves invalid stored lengths.
- **Per-entry exclusions.** Entries without a faithful `_sourceSpan`
  (untilTag stubs, the `SpecificCharacterSet` entry rewritten to
  `ISO_IR 192` at read time), entries materialized through the
  eager-window fallback (`_untrackedNested`), SQ entries containing an
  in-item `SpecificCharacterSet` (whose materialization rewrites the
  value), and entries whose span indexes a different buffer than the
  dict's source (transplanted from another dict) all re-encode.

## Deflate on write

When the dict's transfer syntax is deflated
(`1.2.840.10008.1.2.1.99`), `DicomDict.write` (`src/DicomDict.js`)
follows PS3.10 A.5: the preamble, `DICM`, and the meta group are written
**uncompressed**; the body is produced as explicit little endian into a
scratch stream and then **raw-deflated** (RFC 1951, no zlib header — the
mirror of the read side's `inflateRaw`). Passthrough composes with this:
a deflated source's spans index the *inflated* body buffer, so clean
entries are copied verbatim into the pre-deflate stream and only the
deflate wrapper is recomputed. See the [deflate guide](../guides/deflate.md).

## The byte-identity guarantee

For an eligible file — read by the lazy core, written back with the same
transfer syntax, default write options, a passthrough-safe charset, and
**zero edits** — the writer reproduces the dataset body
**byte-for-byte**: every body element is its verbatim source span,
including sequence delimiters, padding, and encapsulated fragment
framing. The meta group is always re-encoded (its group length is
recomputed), and for deflated files the recompressed wrapper bytes may
differ even though the pre-deflate body is identical.

This guarantee — which the 0.x writer never had — is pinned by the
round-trip suites (`test/write-passthrough.test.js`,
`test/writer-hardening.test.js`, `test/write-deflate.test.js`) over an
adversarial fixture corpus, alongside the equivalence gates of the
[lazy core](./lazy-core.md). The performance characteristics are covered
in [Performance](../performance.md).
