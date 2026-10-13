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
- 2.25 UIDs come from RFC 4122 UUIDs (issue #61).
- The eager reader and the async reader decode a multi-valued ISO 2022
  SpecificCharacterSet (0008,0005). Before, they threw "Using multiple
  character sets is not supported", or used only the first value.
- A CS value loses trailing NUL padding when it is read. Before, a value
  such as `"CT\0"` kept the NUL.
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

## Open items: implementation

- **Temporary dependency of the parser on legacy.** `@dcmjs-org/parser`
  depends on `@dcmjs-org/legacy` for two fallbacks:
  - undefined-length elements that are not SQ
    (`decodeCore.decodeWithEagerReadTag`);
  - the bare (meta-less) dataset fallback in `fromPart10Stream`.

  Move both fallbacks to the standard async handling. Then remove the import
  in `packages/parser/src/index.js`, the dependency in
  `packages/parser/package.json` and `decodeCore.requireEagerReader`. Also
  restore the virtual `jest.mock("@dcmjs-org/legacy")` tripwire in
  `packages/generator/test/standalone.test.js`.
- **Size of the test suites.** `test/eventStream/fromPart10Stream.test.js`
  (about 2,600 lines) and `test/eventStream/streamEquivalence.test.js` (about
  1,500 lines) are large. When the current work stops, keep the tests that
  check the API contract or the user experience, and remove the tests that
  only repeat internal branches.
- **Files that leave the tree before the release.** `test/issues/catalog.json`
  (the issue-triage catalog).
