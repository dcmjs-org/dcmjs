# @dcmjs/fixtures

The DICOM files the dcmjs test suites read. This package is private and never
published. Every file in it must have a row in the repository's
[DATACITATION.md](../../DATACITATION.md) stating where it came from, its
license, and its patient-data status. Tests locate these files through the
`fixturePath()` helper in `test/testUtils.js`.
