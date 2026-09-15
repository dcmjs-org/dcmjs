# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## 2026-08-02
### Deprecated
- **The lazy read core** (`core: "lazy"` / `DCMJS_CORE=lazy`) and the
  byte-identity passthrough write path that depends on it. Stakeholder
  decision: the event-stream API delivers ~90% of the benefit; the
  remaining byte-identity 10% doesn't justify a second buffered read
  engine. `DicomMessage.readFile` defaults to the **eager** core again;
  selecting the lazy core emits a one-time warning. `src/lazy/` and the
  passthrough path will be removed in the next release. Writes remain
  correct DICOM but are re-encoded (no byte-for-byte identity guarantee).

### Changed
- Main test gate is hermetic (ED-2): `test_deflated` uses vendored
  fixtures; the two multi-megabyte network-fixture suites skip unless
  cached or `DCMJS_NETWORK_TESTS=1` (a non-blocking CI job keeps them
  running).
- **One implicit-SQ behavior (AD-1)**: defined-length dictionary-unknown
  implicit elements are never data-peek-promoted to SQ — they decode as
  UN on every read path (eager parity;
  `decodeCore.resolveVrInstance` is the single canonical contract).
  Previously `fromPart10`/`fromPart10Stream` promoted them while
  `readFile` returned UN. The parser's `isSequence()` peek now applies
  only to undefined-length elements, which also fixes throws on
  defined-length values resembling item/delimiter tags.

### Fixed
- Deflate relay bounded memory (ED-1): a fast feed + slow listener could
  balloon the inflated `bodyStream` without bound (DEFLATE expands
  >100×). The relay now feeds pako in small sub-slices and pauses on a
  16 KiB retention watermark with a demand-aware deadlock guard; Gate 5b
  pins the bound.

## 2026-01-19
Added multiple measurements for a single annotation in an SR object

## [0.2.1] - 2018-10-17
### Added
- Added Adapters and Utilities to support translation between common imaging toolkits (Cornerstone, VTK.js) and DICOM Structured Reports. Utilities are tied to the DICOM Standard and help build compliant files. Adapters are specific to the toolkits in question and help make it easier for developers to use the Utilities.

Note: These are generally still a work in progress. We are currently only confident in the Cornerstone Length adapter, and the Utilities (TID1500, TID1501, TID300, Length) which back it.

## [0.2.0] - 2018-10-02
### Added
- Example using [VTK.js with DICOM Segmentation](https://dcmjs-org.github.io/dcmjs/examples/vtkDisplay/index.html)

### Changed
- BitArray class provides static methods
to pack and unpack bit and bytes to support
dicom SEG encoding. 

## [0.1.5] - 2018-08-23
### Fixed
- Fixed dcmjs compatibility with IE11

## [0.1.4] - 2018-08-23
### Added
- Added Webpack and babel to replace Rollup
