# @dcmjs-org/generator

The event-stream writing side of dcmjs: the sinks that consume the
`@dcmjs-org/parser` contract and produce output — `Part10Writer` (collect, then
serialize through the canonical encoder), `StreamingPart10Writer` (emit Part
10 bytes incrementally, bounded memory), and `DicomWebJsonWriter` (the DICOM
JSON model).

Dependencies, by design:

- `@dcmjs-org/parser` for the contract (`EventStreamListener`) and the
  `CollectorListener` the collect-then-serialize writer layers on;
- `@dcmjs-org/core` for the write primitives (`writeDataSet`, `writeTagObject`),
  the Part 10 envelope (`writePart10` — deflate, padding, Big16, group-length
  recomputation; `Part10Writer` is by design a thin layer over it), buffer
  streams, and constants. That is the whole list: the temporary
  `@dcmjs-org/legacy` edge this paragraph used to declare (Part10Writer
  layering on legacy `DicomDict.write()`) closed in October 2026 when that
  envelope was relocated into core as `writePart10` and `DicomDict.write()`
  became a delegating call; `test/standalone.test.js` in this package pins
  the legacy-free module graph.

During the 1.0 beta this package is marked private; the publish flag flips when
the workspace layout settles, per RELEASE_PLAN.md.
