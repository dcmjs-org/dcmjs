# @dcmjs/legacy

The engines dcmjs users run today: the eager whole-file reader and writer
(`DicomMessage`, `DicomDict`), the async reader (`AsyncDicomReader`), and the
dataset serialization helpers (`datasetToBlob`, `datasetToBuffer`,
`datasetToDict`). They keep working unchanged, so current projects keep their
behavior.

Everything here builds on `@dcmjs/core`, never the other way around: no code
in core or in the new streaming engines depends on this package, so the sync
reader can eventually be deprecated and removed without touching them.

For surface compatibility this package also re-exports `DicomMetaDictionary`,
the `BufferStream` classes, and `SplitDataView` from `@dcmjs/core` — they
lived on the legacy surface historically, but their code is core's.

During the 1.0 beta this package is marked private; the publish flag flips when
the workspace layout settles, per RELEASE_PLAN.md.
