# Migrating from dcmjs 0.x

This page describes the 1.0 beta (`@dcmjs-org/dcmjs`) as it stands on the
`1.0-beta` branch. It replaces the migration guide from the earlier 1.0 draft
(PR #512), which described a lazy read core and a byte-faithful write path
that the review removed before anything shipped. If you read that guide,
unlearn it; this page documents only what is on this branch, and every
behavioral claim below names the test suite that pins it.

The short version: the reader and writer you call today are unchanged. The
new work, a streaming engine that reads and writes files larger than
memory, sits beside them and runs only when you call it. Three behaviors
changed on purpose to follow the DICOM standard (see
[BREAKING_CHANGES.md](BREAKING_CHANGES.md)), and naturalization changed in
the six ways described below.

```js
// during the beta the package is @dcmjs-org/dcmjs; later it is "dcmjs"
import dcmjs from "@dcmjs-org/dcmjs";
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

## Naturalization: six changes

Naturalization turns the tag-keyed dict into a keyword-keyed dataset
(`dataset.PatientName` instead of `dict["00100010"]`), and
denaturalization turns it back. Keywords come verbatim from the dictionary
(`test/issues/issue3-keyword-contract.test.js`), and person names
naturalize to component objects that still stringify to the raw PN form
(`test/issues/issue231-pn-accessors.test.js`). The dcmjs surface
(`dcmjs.data.DicomMetaDictionary`) and `@dcmjs-org/core` share one
naturalizer, so these changes apply to both.

Six things changed relative to 0.x:

1. **`_vrMap` now carries entries for elements outside the dictionary.**
   A naturalized dataset has always carried a `_vrMap` side table recording
   the actual VR of elements whose on-wire type was ambiguous. It now also
   records the VR of any element that has no dictionary entry at all, such
   as a private element without a creator, keyed by the element's 8-digit
   hex tag, and the VRs of each private block (change 6). Code that
   iterates or counts `_vrMap` keys sees entries it did not see in 0.x.

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

4. **The dictionary VM decides between a single value and a list.** In
   0.x, every one-value list collapsed to its value. Now a VM of "1" or
   "0-1" gives a single value (`null` when the value is empty), and any
   other VM keeps the list, also for one value. For example `ImageType`,
   `OperatorsName` and `SpecificCharacterSet` stay lists, and an empty
   `ReferringPhysicianName` is `null` instead of `[]`. A binary VR (OB,
   OW, UN, ...) keeps the list, so `dataset.PixelData[0]` works as before.

5. **No Proxy.** A single-item sequence is now the item object itself,
   with a hidden `[0]` (the item), a `length` of 1 and an iterator. Both
   `seq.Field` and `seq[0].Field` work, and so does `for...of`. The value
   is not an array: `Array.isArray`, `forEach`, `map` and `push` do not
   work on it, and `JSON.stringify` gives the item object. The tag Proxy is
   also gone: the readers and naturalize add the PN value accessors when
   they store a value, and a PN value that you assign is converted at once
   by the PN setter (change 6). `ValueRepresentation.addTagAccessors`
   remains on the dcmjs surface as a no-op. Pinned by
   `test/issues/issue218-single-item-sq.test.js` and
   `test/core/naturalizeDataset.test.js`.

6. **Private elements group by reserved block.** A private creator
   (gggg,00xx) reserves the elements (gggg,xx00-xxFF) (PS3.5 7.8.1). The
   creator and its elements now naturalize to one key,
   `` `${gggg}:${creator}` ``, and the element number within the block
   is the key `xEE`:

   ```js
   dataset["0029:ACME"]; // { creator: "ACME", reservedBlock: 0x10, x01: ["a"] }
   dataset._vrMap["0029:ACME"]; // { x01: "LO" }
   ```

   - The 8-digit hex tags (`dataset["00290010"]`, `dataset["00291001"]`)
     remain as non-enumerable aliases. A read works as before, and a write
     to an element alias goes to the block. The creator alias is read-only:
     a write to it throws `TypeError` in strict-mode code. A `delete` of an
     element alias still removes the element from the written output, and a
     `delete` of the creator alias removes the whole block, so code that
     removes private tags by hex key keeps working, through
     `denaturalizeDataset` and through `fromNaturalized`. A delete always
     wins, also over a later write into the block; set a value on the
     deleted hex name to add the element again. A copy of the
     dataset (an object spread, JSON, `deepCloneInstance`) does not keep
     such a delete, so delete in the block (`delete
     dataset["0029:ACME"].x01`) when you copy the dataset later.
     `Object.keys` and `JSON.stringify` no longer show the hex keys.
   - A source that gives one creator two blocks in a group (PS3.5 7.8.1
     does not permit this) gets one merged block and a warning.
   - A `registerTag()` keyword for a private tag is a non-enumerable alias
     on the dataset and in the block. A private dictionary keyword (for
     example `CSAImageHeaderInfo`) is an alias in the block only.
   - A private element without a creator keeps its hex tag as the key.
   - A private or unknown element (no dictionary VM) is a list, also for
     one value, as for VM > 1: `dataset["00311001"]` is `["a"]`, not `"a"`.
     A private or unknown sequence with one item is the array-like item
     object, as for a standard sequence.
   - `denaturalizeDataset` accepts the block form and the hex-tag form. It
     keeps `reservedBlock` when that block is free in the group, and moves
     the block to the first free xx when it is not.
   - `NaturalizedListener` (`toNaturalized()`) gives the same object as
     `naturalizeDataset`, `_vrMap` included. Its earlier draft keys
     (`"10:ACME"`, `originalTagOffset`) are gone. Its binary values are a
     list of `ArrayBuffer`, as `naturalizeDataset` gives, in place of the
     earlier `{ InlineBinary }` wrapper.
   - A binary element with no value is `null` in both naturalizers, and a
     binary element with values is always a list, also of one value.
   - Both naturalizers take `{ binaryAs: "Uint8Array" }` to give each
     binary fragment as a `Uint8Array` view with no copy. The default stays
     `ArrayBuffer`. In the default mode, `toNaturalized()` copies a fragment
     that is a view into a larger buffer (for example pixel data read from
     Part 10 bytes) to its own `ArrayBuffer`. Before, it kept the view. Use
     `Uint8Array` to avoid the copy for large pixel data.
   - `DicomEventStream.fromNaturalized()` streams a naturalized dataset to
     any sink, for example `Part10Writer`.
   - A PN attribute converts an assigned string at once:
     `dataset.PatientName = "Doe^John"` stores
     `{ Alphabetic: "Doe^John" }`, and `String(dataset.PatientName)` gives
     `"Doe^John"`. Code that compared the attribute with a string after
     the assignment must compare `String(dataset.PatientName)`. The
     setter copies an assigned object, gives `null` (VM 1) or `[]` for
     `""`, and drops an
     empty name between two `\` delimiters. A copy of the dataset (a
     spread, `deepCloneInstance`) has plain values and no setter, and
     `Object.freeze` does not stop a write through the setter.
   - A present element with no `Value`, as DICOMweb JSON gives for an
     empty element, is `[]` for a list VM (for example `ImageType`) and
     `null` for a scalar VM, the same as an empty `Value`. Before, it was
     always `null` from `naturalizeDataset`.
   - A `null` entry in a value list (an empty value in DICOM JSON, or an
     empty DS read as `Value: [null]`) now denaturalizes, and every writer
     writes it as an empty value: empty text for a string VR (before, LO,
     SH, ST, LT, UC and UT wrote the text `null`), an empty name in its
     position for PN, and `0` with a warning for a binary number VR (US,
     SS, UL, SL, FL, FD, UV, AT), which has no empty value. Before,
     `denaturalizeDataset` threw on it. An element with no value (`null`,
     not in a list) is written with zero length, with no warning.
   - `@dcmjs-org/core` and `dcmjs.data` export `setAttribute`,
     `setPersonName` and `setVr` to add or replace an attribute in the
     naturalized form, and `definePrivateAliases`.

   [specs/naturalized-dataset.md](specs/naturalized-dataset.md) gives the
   full rules. Pinned by `test/core/privateBlocks.test.js` and
   `test/issues/issue388-private-tags.test.js`.

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
engine lives in the `@dcmjs-org/dcmjs/eventStream` subpath and runs only
when called. It reads
a file the way you read a book, one piece at a time, instead of
photocopying the whole book first, so the same code that handles a 500 KB
slice handles a multi-gigabyte video instance in bounded memory.

```js
import { DicomEventStream } from "@dcmjs-org/dcmjs/eventStream";

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
imports `@dcmjs-org/dcmjs/eventStream` runs the same code paths it ran on 0.x, give
or take the fixes and the deliberate changes listed above.

## Package names

This branch splits the repository into workspace packages under the
`@dcmjs-org` scope: `@dcmjs-org/core` (shared value types and the
dictionary), `@dcmjs-org/legacy` (the eager reader and writer you call
through `dcmjs.data`), `@dcmjs-org/parser` (the streaming reading side),
and `@dcmjs-org/generator` (the streaming writing side). Application code
does not need to import them directly.

**FHIR is preliminary.** The DICOM-to-FHIR mapping is the separate
package `@dcmjs-org/fhir`, and the wrapper does not re-export it as a
subpath. Import `@dcmjs-org/fhir` directly. Its options and output can
change in a minor release. `DicomEventStream.fromFhir()` and `toFhir()`
use it and are preliminary too.

The `dcmjs` package surface is the wrapper `@dcmjs-org/dcmjs`. It
reproduces the 0.x surface, so a project can try 1.0 by changing only the
import name. During the beta it publishes on the `beta` tag
(`npm install @dcmjs-org/dcmjs@beta`); the unscoped `dcmjs` name starts
publishing when the maintainers decide it is ready.

The new engines are subpath entries, and they are ES modules only:
`@dcmjs-org/dcmjs/eventStream`, `/media`, `/encapsulated` and `/image`.
A `require()` of a subpath fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. jest resolves with the CommonJS
conditions, so it does not find a subpath, and it gives the UMD build for
the default entry. Map the default entry and each subpath to its ESM file
in the jest config, so that all of them share one copy of the reader state:

```js
// jest.config.js
moduleNameMapper: {
    "^@dcmjs-org/dcmjs$":
        "<rootDir>/node_modules/@dcmjs-org/dcmjs/build/dcmjs.es.js",
    "^@dcmjs-org/dcmjs/(eventStream|media|encapsulated|image)$":
        "<rootDir>/node_modules/@dcmjs-org/dcmjs/build/$1.es.js"
},
transformIgnorePatterns: ["/node_modules/(?!@dcmjs-org)"]
```

The build files are ES modules, so jest must transform them: use a
project-wide `babel.config.js` with `@babel/preset-env`. A `.babelrc` does
not apply to files in `node_modules`.

Use `import` for the default entry
too when you use a subpath: a `require()` of the default entry loads the
UMD build, which has its own copy of the reader state (the log level,
`registerTag()` entries).

The ESM entries read the `LOG_LEVEL` environment variable when they load:
a loglevel level (`trace`, `debug`, `info`, `warn`, `error`, `silent`, in
any case, or a number from `0` to `5`) applies, and any other value gives
`warn`. The UMD builds use the level
fixed at build time.

## What needs no migration, in one list

-   `DicomMessage.readFile`: same call, same eager decode, same error
    timing, same options.
-   `DicomDict`: same `meta` / `dict` shape, `upsertTag`, `write()`.
-   Editing: in-place mutation, assignment, `delete`, all as in 0.x.
-   Naturalized dataset shapes: keywords, person-name accessors,
    `InlineBinary` / `BulkDataURI` passthrough. (Single-item sequences
    and the single-value collapse changed; see "Naturalization".)
-   `DicomMessage.read` and `DicomMessage.readTag`: still present, still
    deprecated, still warning.
-   The `DICOMWEB` class, adapters, structured reports, derivations,
    normalizers, utilities: untouched by the engine work on this branch.
