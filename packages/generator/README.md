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
  buffer streams, and constants — `StreamingPart10Writer` and
  `DicomWebJsonWriter` need nothing else;
- `@dcmjs-org/legacy` TEMPORARILY, for `Part10Writer` only: it is by design a
  thin layer over `DicomDict.write()`, the canonical encoder (deflate,
  padding, Big16, group-length recomputation). The edge disappears when that
  serializer grows a home that is not the legacy surface type — until then
  only this one module imports it.

During the 1.0 beta this package is marked private; the publish flag flips when
the workspace layout settles, per RELEASE_PLAN.md.
