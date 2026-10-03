# Migrating from dcmjs 0.x

This page describes the 1.0 beta as it stands on the `release/1.0-beta-core`
staging branch. It replaces the migration guide from the earlier 1.0 draft
(PR #512), which described a lazy read core and a byte-faithful write path
that the review removed before anything shipped. If you read that guide,
unlearn it; this page documents only what is on this branch, and every
behavioral claim below names the test suite that pins it.

The short version: the reader and writer you call today are unchanged. The
new work, a streaming engine that reads and writes files larger than
memory, sits beside them and runs only when you call it. Three behaviors
changed on purpose to follow the DICOM standard (see
[BREAKING_CHANGES.md](BREAKING_CHANGES.md)), and naturalization changed in
three ways described below.

```js
import dcmjs from "dcmjs";
const { DicomMessage, DicomDict, DicomMetaDictionary } = dcmjs.data;
```

## Reading: no migration

`DicomMessage.readFile` works exactly as in 0.x. The whole buffer goes in,
every value in the file is decoded inside the call, and a parsed
`DicomDict` comes out with the same shape: the same `meta` / `dict` split,
the same uppercase string keys (`"00100010"`), the same
`{ vr, Value, _rawValue }` entries.

```js
// 0.x and 1.0 are the same call with the same timing:
const dicomDict = DicomMessage.readFile(arrayBuffer);
const name = dicomDict.dict["00100010"].Value;
```

Error handling needs no change either. Structural errors (a missing `DICM`
marker, malformed framing) and value errors both surface inside `readFile`,
so one `try`/`catch` around the call still catches everything, exactly as
in 0.x.

The read options keep their 0.x semantics: `ignoreErrors`, `untilTag`,
`includeUntilTagValue`, `noCopy`, and `forceStoreRaw`.

There is no `core` option on `readFile`, no `DCMJS_CORE` environment
variable, and no lazy reader in 1.0. An earlier draft of 1.0 re-platformed
reading onto a lazy, decode-on-first-access core; the review removed that
core entirely, so advice written against it (splitting `try`/`catch` into a
structural phase and a value phase, forcing materialization after reading)
applies to nothing in this release.

One new opt-in: `allowMissingHeader: true` accepts files whose 128-byte
preamble and `DICM` marker were stripped by an exporter, and even bare
datasets with no file meta group at all (issue #93). The default stays
strict. Pinned by `test/issues/issue93-missing-preamble.test.js`.

```js
const dicomDict = DicomMessage.readFile(headerlessBuffer, {
    allowMissingHeader: true
});
```

## Editing: no migration

Every element re-encodes on every write, the same as 0.x, so in-place
mutation of a decoded value still works:

```js
// Still fine in 1.0, exactly as in 0.x:
dicomDict.dict["00100010"].Value[0] = "Anonymous^Patient";
dicomDict.dict["00080008"].Value.push("DERIVED");
```

The earlier draft's writer emitted the original source bytes for entries it
considered untouched, which made in-place mutation a silent data-loss
hazard and required edit-by-assignment throughout. That writer left with
the lazy core. `upsertTag`, direct key assignment, and `delete` all work as
they did in 0.x.

## Writing: what is and is not guaranteed

`DicomDict.write()` re-encodes the dataset. The guarantee is round-trip
integrity, not byte identity: reading a file and writing it back yields a
correct DICOM file that parses to the same dataset, with the same element
set and values and byte-identical `PixelData`, but not necessarily the
same bytes on disk (group lengths are recomputed, and encoding details
such as undefined-length framing can differ). Do not assert
`out[i] === src[i]` over a rewrite; that assertion belonged to the earlier
draft's passthrough writer and was removed with it.

What is pinned, and where:

-   Read, naturalize, denaturalize, write, and read again preserves the
    element set, representative values, and `PixelData` bytes, and the
    output size stabilizes across repeated rewrite cycles.
    `test/issues/issue111-roundtrip-integrity.test.js`.
-   Per-VR value round trips across transfer syntaxes.
    `test/lossless-read-write.test.js`.

`writeOptions` keep their 0.x semantics, including
`allowInvalidVRLength` and `fragmentMultiframe`.

### Deflate is now real on write

If the meta group declares the deflated transfer syntax
(`1.2.840.10008.1.2.1.99`), 0.x silently wrote an uncompressed body under
the deflated label, producing non-conformant files. 1.0 writes what the
standard requires (PS3.10 A.5): an uncompressed preamble, `DICM` marker,
and meta group, followed by a raw-deflated (RFC 1951) body. Reading
deflated files worked in 0.x and still works; writing them is what
changed. Pinned by `test/write-deflate.test.js`.

```js
dicomDict.meta["00020010"].Value = ["1.2.840.10008.1.2.1.99"];
const bytes = dicomDict.write(); // body is actually deflated now
DicomMessage.readFile(bytes); // round-trips
```

If a downstream consumer depended on the 0.x bug and read the "deflated"
file without inflating, it now receives a real deflate stream. Either keep
writing plain explicit little endian (set the transfer syntax UID to
`1.2.840.10008.1.2.1` before writing) or teach the consumer to inflate.

## Naturalization: three changes

Naturalization turns the tag-keyed dict into a keyword-keyed dataset
(`dataset.PatientName` instead of `dict["00100010"]`), and
denaturalization turns it back. The core contract is unchanged and pinned:
keywords come verbatim from the dictionary
(`test/issues/issue3-keyword-contract.test.js`), single-item sequences stay
length-1 proxy arrays that allow both access styles
(`test/issues/issue218-single-item-sq.test.js`), person names naturalize to
component objects that still stringify to the raw PN form
(`test/issues/issue231-pn-accessors.test.js`), and the single-value
collapse works as before.

Three things did change relative to 0.x:

1. **`_vrMap` now carries entries for elements outside the dictionary.**
   A naturalized dataset has always carried a `_vrMap` side table recording
   the actual VR of elements whose on-wire type was ambiguous. It now also
   records the VR of any element that has no dictionary entry at all, such
   as an unregistered private tag, keyed by the element's 8-digit hex tag.
   Code that iterates or counts `_vrMap` keys sees entries it did not see
   in 0.x.

2. **Private elements survive the round trip.** In 0.x,
   `denaturalizeDataset` logged "Unknown name in dataset" for an
   unregistered element and dropped it, so naturalize-then-denaturalize
   silently lost private data. It now rebuilds the element from the VR
   recorded in `_vrMap`, so the element survives into the written file.
   Code that compared datasets across a round trip, or counted the keys of
   a denaturalized dataset, now sees elements that 0.x discarded. Pinned by
   `test/issues/issue388-private-tags.test.js` and the issue111 round-trip
   suite.

3. **`registerTag()` keywords denaturalize symmetrically.** In 0.x,
   registering a custom tag taught `naturalizeDataset` its keyword, but
   `denaturalizeDataset` could not map the keyword back and dropped the
   element. Registration is now symmetric: the registry keeps its own
   name index, which `denaturalizeDataset` consults after the standard
   `nameMap`. Reading or naturalizing a dataset never mutates the shared
   `DicomMetaDictionary.nameMap`. (An intermediate 1.0 draft achieved
   symmetry by writing into the global `nameMap` as a side effect of
   `naturalizeDataset`; review finding 32 removed that, and this branch
   carries the side-effect-free form.)

## Behavior changes made for standard compliance

Three behaviors changed deliberately because the old behavior violated the
DICOM standard. Each is documented in
[BREAKING_CHANGES.md](BREAKING_CHANGES.md) with the governing section of
the standard and a way forward for code that relied on the old behavior:

-   `DicomMetaDictionary.uid()` now derives UIDs from a real 128-bit
    RFC 4122 UUID, so the integer part is at most 39 digits rather than
    always 39.
-   `Tag.isPrivateCreator()` follows PS3.5 7.8.1: private creators live in
    elements 0x0010 through 0x00FF, and the formerly accepted
    0x0001 through 0x000F range now reads as UN with bytes preserved.
-   The anonymizer's default keyword list is corrected so `cleanTags()`
    actually empties attributes the misspelled 0.x list silently skipped.
    The corrected list arrives with the anonymizer port; the contract and
    the opt-out recipe are documented ahead of it.

## The streaming engine: new and opt-in

Everything above concerns the classic whole-buffer engine, which remains
the default and the only thing `DicomMessage.readFile` uses. The new
engine lives under `dcmjs.eventStream` and runs only when called. It reads
a file the way you read a book, one piece at a time, instead of
photocopying the whole book first, so the same code that handles a 500 KB
slice handles a multi-gigabyte video instance in bounded memory.

```js
const { DicomEventStream } = dcmjs.eventStream;

const dataset = await DicomEventStream.fromPart10Stream(
    fs.createReadStream("large-file.dcm")
).toNaturalized();
```

`DicomEventStream` accepts buffers, Node read streams, WHATWG
`ReadableStream`s, async iterables, parsed datasets, and DICOMweb JSON,
and produces naturalized datasets, DICOMweb JSON, `{ meta, dict }` trees,
or Part 10 bytes. `StreamingPart10Writer` is the incremental writing side.
[EXAMPLES.md](../EXAMPLES.md) walks through all of it against real files,
including the memory measurements. `AsyncDicomReader` also remains
available, unchanged in how you call it.

Nothing routes through this engine implicitly. A project that never
imports `dcmjs.eventStream` runs the same code paths it ran on 0.x, give
or take the fixes and the deliberate changes listed above.

## Package names

This branch splits the repository into workspace packages under the
`@dcmjs-org` scope: `@dcmjs-org/core` (shared value types and the
dictionary), `@dcmjs-org/legacy` (the eager reader and writer you call
through `dcmjs.data`), `@dcmjs-org/parser` (the streaming reading side),
and `@dcmjs-org/generator` (the streaming writing side). Application code
does not need to import them directly.

The `dcmjs` package surface itself arrives with the wrapper release: a
thin package that reproduces the 0.x surface by re-exporting the engine
packages plus the classic extras. During the beta that wrapper publishes
as `@dcmjs-org/dcmjs`, so a project can try 1.0 by changing only the
import name; the unscoped `dcmjs` name starts publishing when the
maintainers decide it is ready.

## What needs no migration, in one list

-   `DicomMessage.readFile`: same call, same eager decode, same error
    timing, same options.
-   `DicomDict`: same `meta` / `dict` shape, `upsertTag`, `write()`.
-   Editing: in-place mutation, assignment, `delete`, all as in 0.x.
-   Naturalized dataset shapes: keywords, single-item sequence proxies,
    person-name accessors, scalar collapse, `InlineBinary` /
    `BulkDataURI` passthrough.
-   `DicomMessage.read` and `DicomMessage.readTag`: still present, still
    deprecated, still warning.
-   The `DICOMWEB` class, adapters, structured reports, derivations,
    normalizers, utilities: untouched by the engine work on this branch.
