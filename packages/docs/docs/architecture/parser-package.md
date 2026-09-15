---
title: The parser package
---

`@dcmjs/parser` (`packages/parser`) is layer 0 of dcmjs: a DICOM Part 10
tokenizer that records *byte offsets* instead of decoding values. It is
the dicom-parser codebase, vendored whole into the monorepo and then
deliberately diverged (see below).

:::warning Internal package
`@dcmjs/parser` is a private workspace package (`"private": true`,
version `0.0.0`). It is **not published to npm** and dcmjs exposes **no
public subpath** for it yet — today it is reachable only from inside this
repository. A public surface is on the [roadmap](../development/roadmap.md).
If you currently depend on the upstream `dicom-parser` npm package, see
[Migrating from dicom-parser](../migration/from-dicom-parser.md).
:::

## Zero dependencies

The package has no `dependencies` at all (`packages/parser/package.json`).
It contains no tag dictionary and no character-set handling: implicit-VR
resolution is injectable through a `vrCallback` option, and string
accessors keep byte-identity latin semantics. Dictionary and charset
awareness live one layer up, in the dcmjs data model — see
[The lazy read core](./lazy-core.md).

A TypeScript surface seed exists at `packages/parser/index.d.ts`.

## The element model

`parseDicom(byteArray, options)` returns a `DataSet` whose `elements` map
is keyed by parser-style tag strings (`'x' + 8 lowercase hex digits`).
Every element is constructed as a single object literal with **all fields
present** (one hidden class for every element, a deliberate perf
property — `readDicomElementExplicit.js`):

```js
{
  tag: "x00080005",          // 'xggggeeee' string key (parser-internal)
  tagValue: 0x00080005,      // numeric (group << 16 | element) >>> 0
  vr: "CS",                  // undefined for implicit VR without vrCallback
  length: 10,                // value length in bytes (corrected for undefined length)
  dataOffset: 144,           // offset of the first value byte
  startOffset: 136,          // offset where the element's tag begins
  endOffset: 154,            // offset after the element is fully consumed,
                             // INCLUDING any item/sequence delimiters
  hadUndefinedLength: false, // true when the stored length was 0xFFFFFFFF
  parser: undefined,         // per-element byte-order override (meta group)
  items: undefined,          // SQ: parsed sequence items ({ dataSet, ... })
  fragments: undefined,      // encapsulated pixel data fragment descriptors
  basicOffsetTable: undefined, // encapsulated pixel data BOT entries
  encapsulatedPixelData: false,
  Value: undefined           // escape hatch for pre-resolved tiny values
}
```

`tagValue`, `startOffset`, and `endOffset` are dcmjs additions over
upstream dicom-parser:

- `tagValue` is the numeric tag identity dcmjs uses internally
  everywhere; string keys survive only at API boundaries.
- `startOffset`/`endOffset` record the element's complete on-disk span.
  Neither is recoverable after the fact: the header size depends on the
  VR (and on implicit vs. explicit framing), and the corrected `length`
  of undefined-length elements excludes the delimiter items. The span is
  the prerequisite for the [passthrough writer](./writer.md).

For an element stopped at by `untilTag` (which is *inclusive* — the
element at `untilTag` is read), the value is not consumed, and
`endOffset` is the declared span for defined lengths or the post-header
position for undefined lengths (`readDicomElementExplicit.js`,
`readDicomElementImplicit.js`).

## Lazy DataSet accessors

`DataSet` (`packages/parser/src/dataSet.js`) decodes values on demand,
straight out of the byte array at `element.dataOffset`:

| Accessor | VRs it serves |
| --- | --- |
| `uint16(tag, index)` / `int16(tag, index)` | US / SS |
| `uint32(tag, index)` / `int32(tag, index)` | UL / SL |
| `float(tag, index)` / `double(tag, index)` | FL / FD |
| `string(tag, index)` | AE, CS, SH, LO (trims leading/trailing spaces) |
| `text(tag, index)` | UT, ST, LT (preserves leading spaces) |
| `floatString(tag, index)` / `intString(tag, index)` | DS / IS |
| `attributeTag(tag)` | AT |
| `numStringValues(tag)` | actual VM of a multi-valued string element |

All of them return `undefined` for absent or zero-length elements. String
accessors decode with fixed latin semantics (`readFixedString`) — by
design, since character sets are a data-layer concern.

## Encapsulated pixel data utilities

For encapsulated (undefined-length) pixel data, the tokenizer records the
`basicOffsetTable` and a `fragments` array
(`{ offset, position, length }` per fragment) on the element. The package
ships the frame-extraction toolkit on top of those indexes:

- `readEncapsulatedImageFrame(dataSet, pixelDataElement, frameIndex, basicOffsetTable?, fragments?)`
  — frame extraction driven by the basic offset table.
- `readEncapsulatedPixelDataFromFragments(dataSet, pixelDataElement, startFragmentIndex, numFragments?, fragments?)`
  — frame extraction by explicit fragment range (single-fragment frames
  come back as zero-copy views via `sharedCopy`).
- `createJPEGBasicOffsetTable(dataSet, pixelDataElement, fragments?)` —
  builds a BOT for JPEG streams that ship without one.
- `readEncapsulatedPixelData(dataSet, pixelDataElement, frame)` —
  deprecated upstream API, kept for completeness.

The dcmjs lazy core builds its pixel-data frame values from these same
fragment indexes — see [The lazy read core](./lazy-core.md).

## Intentional divergences from upstream dicom-parser

The vendored tokenizer is not a frozen copy. Because it has no external
consumers, dcmjs fixed and aligned the following (each pinned by tests in
`packages/parser/test`, a suite of 245 offline tests):

1. **UV/SV/OV framing** (`readDicomElementExplicit.js`,
   `test/uvSvOv.test.js`). The 2019+ VRs UV, SV, and OV are in the VR
   lookup with reserved-bytes + 4-byte-length framing. Upstream did not
   know them, desynced the element stream, and fabricated phantom
   elements from value bytes.
2. **Eager-aligned unknown-VR fallback** (`readDicomElementExplicit.js`).
   An unrecognized VR byte pair is framed like UN (2 reserved bytes +
   4-byte length) instead of upstream's assumed 2-byte length. This
   matches the dcmjs eager reader, which uses 32-bit framing for any VR
   whose `isLength32()` is true, including VRs it does not recognize.
3. **Explicit FFFE delimiter framing** (`readDicomElementExplicit.js`).
   Item and delimitation tags (group `FFFE`) are encoded without VR bytes
   in every transfer syntax (PS3.5 section 7.5), so they are recognized
   up front: tag, then a 4-byte length directly. Upstream's 2-byte
   unknown-VR fallback only consumed them correctly by accident.
4. **Deflate stream fix** (`parseDicom.js`). For the deflated transfer
   syntax (`1.2.840.10008.1.2.1.99`), the dataset stream over the
   header + inflated buffer starts at the post-meta `position`, like
   every other syntax. Upstream started at 0 and re-walked the
   preamble/meta header as junk elements — a walk that only parsed under
   the old 2-byte unknown-VR stride.
5. **`warnings.push` fix** (`findItemDelimitationItem.js`). Upstream
   called `warnings(...)` as a function — a crash on the path that
   reports non-zero-length item delimiters. The duplicate
   `findAndSetUNElementLength.js` carrying the same bug was deleted.
6. **`omitPrivateAttributes` rename** (`util/dataSetToJS.js`). The
   `explicitDataSetToJS` option was misspelled `omitPrivateAttibutes`
   upstream; dcmjs uses the corrected spelling.
7. **Undefined-length-only implicit SQ peek** (`readDicomElementImplicit.js`,
   AD-1 2026-08-02). The `isSequence()` data peek (first 4 value bytes =
   item tag / sequence delimiter) applies only to undefined-length
   dictionary-unknown elements, where framing genuinely needs it. Upstream
   also peeked defined-length elements, which (a) contradicted the dcmjs
   semantic contract (`decodeCore.resolveVrInstance`, eager parity: defined
   lengths are never promoted to SQ) and (b) threw on defined-length values
   that merely resemble item/delimiter tags (e.g. pixel data starting with
   FFFE bytes) or are shorter than the 4-byte peek.

On top of these come the element-model additions described above
(`tagValue`, `startOffset`, `endOffset`, the stable single-shape object
literal) and mechanical performance work with no behavior change
(interned VR + length-size lookup table, numeric peeks in the
sequence/delimiter scans, scratch-buffer float reads, `Uint8Array.set`
fragment assembly).

Everything else — including `readFixedString`'s byte-identity latin
semantics — stays byte-for-byte compatible with upstream behavior.

## How dcmjs uses it

The only in-repo consumer is the lazy read core:
`src/lazy/LazyDicomReader.js` calls `parseDicom` with an injected `pako`
inflater and a dictionary-backed `vrCallback`, then wraps the offset
elements into lazy `DicomDict` entries. The element spans feed the
writer's passthrough path. Continue with
[The lazy read core](./lazy-core.md) and [The writer](./writer.md).
