# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## Unreleased
### Fixed
- `Colors` now converts DICOM CIELab relative to the D50 white point (ICC PCS), as PS3.3 C.10.7.1.1 requires. The previous D65 results were wrong for chromatic colors and did not agree with DCMTK, PixelMed and highdicom. `rgb2XYZ`, `xyz2RGB`, `lab2XYZ` and `xyz2LAB` now use D50 XYZ. Values that the old `rgb2DICOMLAB` wrote now display slightly differently; for example, an old pure blue now decodes to `[91, 0, 255]`. Gray values do not change.
- Out-of-gamut colors are clipped per channel, which keeps the hue.

### Added
- `Colors.dicomlab2RGB8`, `Colors.rgb82DICOMLAB` and `Colors.d50WhitePointXYZ`.

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
