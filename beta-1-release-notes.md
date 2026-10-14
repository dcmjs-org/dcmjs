# dcmjs 1.0 beta 1: release notes and open items

This file records two things for the 1.0 beta 1 release:

1. The changes that a user of dcmjs can see.
2. The work that is still open. The team does this work after all of the
   staged package pull requests merge into `1.0-beta`.

The sections keep user requirements and implementation items apart. A change
to a user-facing item needs a decision. You can change an implementation item
when a better approach appears.

## User-facing changes in beta 1

`docs/BREAKING_CHANGES.md` gives the full contract and the opt-out recipes.
`docs/MIGRATION.md` gives the migration steps from 0.x.

- `cleanTags` empties about 103 more attributes. The old default list of
  `tagNamesToEmpty` had names that did not match a dictionary keyword, and the
  anonymizer skipped them. The list now includes reference sequences, for
  example `ReferencedStudySequence` and `ReferencedPatientSequence`.
- Input that is not DICOM fails with the error message of the streaming
  reader. The error text of the old vendored tokenizer is gone.
- A non-conformant undefined-length UT element throws on both entry points.
  Before, the buffered path returned wrong data and gave no error.
- The `xs` meta-VR resolves correctly for signed pixel data, on the sync
  reader and on the async reader.
- The fallback for an unknown VR logs one time, not one time for each
  element.
- A UV element with null values writes. Before, the write threw.
- A private element survives denaturalize and write. Before, the writer
  dropped the element or wrote it in a shape that it could not read back.
- An overstated File Meta group length (0002,0000) recovers with a warning.
  Before, the reader put the start of the body at the wrong offset.
- `DicomMessage.readFile(buffer, { allowMissingHeader: true })` reads input
  that has no Part 10 header (issue #93).
- `fromPart10Stream` streams a bare dataset (no Part 10 header) through its
  normal body loop. `startDataSet` now gives the detected transfer syntax.
  With `ignoreErrors: true`, a malformed bare dataset now throws, as other
  input does. Before, the eager reader returned the elements before the error.
- `ValueRepresentation.setDicomMessageClass`,
  `ValueRepresentation.getDicomMessageClass` and `Tag.setDicomMessageClass`
  are removed. `@dcmjs-org/core` no longer calls the eager reader. A direct
  call of the SQ `read` must give `readOptions.readItem(itemStream, syntax)`.
- `@dcmjs-org/parser` no longer depends on `@dcmjs-org/legacy`.
- 2.25 UIDs come from RFC 4122 UUIDs (issue #61).
- The eager reader and the async reader decode a multi-valued ISO 2022
  SpecificCharacterSet (0008,0005). Before, they threw "Using multiple
  character sets is not supported", or used only the first value.
- A CS value loses trailing NUL padding when it is read. Before, a value
  such as `"CT\0"` kept the NUL.
- Naturalization has no Proxy, and the dictionary VM decides the shape. A
  VM of "1" or "0-1" gives a single value, or `null` when empty. Any other VM
  keeps the list, also for one value (for example `ImageType`). A binary VR
  keeps the list. A single-item sequence is the item object, with a hidden
  `[0]`, a `length` of 1 and an iterator; it is not an array, so `forEach`,
  `map` and `push` do not work on it. A PN value that a caller assigns gets
  its accessors when the dataset is denaturalized. `addTagAccessors` is a
  no-op. `docs/MIGRATION.md` gives the details.
- New packages: `@dcmjs-org/core`, `@dcmjs-org/legacy`, `@dcmjs-org/parser`
  and `@dcmjs-org/generator`. Each package publishes a built `dist/` folder
  (ES module and CommonJS), so it loads in plain Node without a bundler.

## Open items: user-facing

- **`DicomEventStream.from()` and stream input.** `from()` sends every object
  that is not a buffer to `fromDicomWebJson`. A Node Readable, a web
  `ReadableStream` or an AsyncIterable of Part 10 chunks must go to
  `fromPart10Stream`, or `from()` must throw a clear `TypeError`.
- **`docs/BREAKING_CHANGES.md` and `cleanTags`.** The note lists
  `IconImageSequence` as newly emptied, but the old list already emptied it.
  The note does not list `ReferencedStudySequence`,
  `ReferencedPatientSequence`, `ReferencedPerformedProcedureStepSequence` and
  `OtherPatientIDsSequence`. Correct the list.
- **Basic Offset Table in `StreamingPart10Writer`.** The writer always writes
  an empty Basic Offset Table. When the fragments pass through without a
  change, and a frame has more than one fragment, the output loses the frame
  boundaries. Keep the source table when the fragments do not change, or write
  an Extended Offset Table.
- **Original SpecificCharacterSet.** The readers replace (0008,0005) with
  `ISO_IR 192`. Bulk data decoding needs the original value. The readers must
  keep the original value (see the TODO in
  `packages/legacy/src/AsyncDicomReader.js`).
- **Replace `AsyncDicomReader`.** Two async Part 10 readers exist:
  `AsyncDicomReader` in legacy and `fromPart10Stream` in the parser. Beta 1
  keeps the old `AsyncDicomReader` class without a change. A later 1.0 beta
  replaces the class:
  - Add a small reader class in the parser that runs `fromPart10Stream` and
    sends its events to a listener.
  - Make legacy re-export that class, and remove the old class.
  - Update the tests and the docs that use the old API, for example
    `docs/AsyncDicomReader-skill.md`.

  This change breaks the API of `AsyncDicomReader` and of its listener
  (`addTag`, `startObject`, `pop`). Record the break in
  `docs/BREAKING_CHANGES.md`.

## Open items: implementation

- **Size of the test suites.** `test/eventStream/fromPart10Stream.test.js`
  (about 2,600 lines) and `test/eventStream/streamEquivalence.test.js` (about
  1,500 lines) are large. When the current work stops, keep the tests that
  check the API contract or the user experience, and remove the tests that
  only repeat internal branches.
- **Files that leave the tree before the release.** `test/issues/catalog.json`
  (the issue-triage catalog).
