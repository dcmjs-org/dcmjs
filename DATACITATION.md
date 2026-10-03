# Data citation

Every DICOM file committed to this repository as test data is listed here,
with its origin and license. Two things depend on this list:

1. **Licensing.** Test files come from real projects and real archives.
   Redistributing them requires knowing, and honoring, the terms they were
   published under.
2. **Privacy.** DICOM files can carry patient information. Every file in
   this repository must be synthetic (made up, never belonging to a real
   person) or verifiably de-identified, and this list records which, and
   on whose authority.

The format follows the example of
[OHIF's DATACITATION.md](https://github.com/OHIF/Viewers/blob/master/DATACITATION.md).

## Adding a file

No DICOM file merges without a row in the table below. The row must be in
the same pull request as the file. If you cannot state where a file came
from and what license covers it, the file cannot land; generate a
synthetic replacement instead.

## Files

| File                                                                         | Origin                                                                                                                                                          | License                | Patient data                                   | Citation / notes                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------- | -------------------------------------- |
| `packages/fixtures/dicom/sample-dicom.dcm`                                   | _provenance being traced — see below_                                                                                                                           | —                      | believed de-identified                         | —                                      |
| `packages/fixtures/dicom/sample-sr.dcm`                                      | _provenance being traced — see below_                                                                                                                           | —                      | believed de-identified                         | —                                      |
| `packages/fixtures/dicom/sample-op.dcm`                                      | _provenance being traced — see below_                                                                                                                           | —                      | believed de-identified                         | —                                      |
| `packages/fixtures/dicom/cine-test.dcm`                                      | _provenance being traced — see below_                                                                                                                           | —                      | believed de-identified                         | —                                      |
| `packages/fixtures/dicom/invalid-vr-length-test.dcm`                         | _provenance being traced — see below_                                                                                                                           | —                      | believed de-identified                         | —                                      |
| `packages/fixtures/dicom/no-meta-length-test.dcm`                            | _provenance being traced — see below_                                                                                                                           | —                      | believed de-identified                         | —                                      |
| downloaded fixtures                                                          | [dcmjs-org/data](https://github.com/dcmjs-org/data) releases, fetched at test time, not committed                                                               | per that repository    | per that repository                            | URLs in `test/testUtils.js` call sites |
| `packages/fixtures/testImages/CT1_UNC.*.dcm` (3 files)                       | [cornerstonejs/dicomParser](https://github.com/cornerstonejs/dicomParser) test corpus; endianness variants made with dcmtk `dcmconv` (see the directory README) | MIT (dicomParser)      | believed de-identified (published test corpus) | classic CT1_UNC sample                 |
| `packages/fixtures/testImages/deflate/{image,report,wave}_dfl` (3 files)     | [dclunie.com deflate test set](http://www.dclunie.com/images/compressed/deflate_tests_release.tar.gz)                                                           | as published by author | believed de-identified (published test set)    | extension-less deflate syntax samples  |
| `packages/fixtures/testImages/encapsulated/single-frame/CT1_UNC.*` (5 files) | [cornerstonejs/dicomParser](https://github.com/cornerstonejs/dicomParser) test corpus; JPEG-LS fragment variants of CT1_UNC                                     | MIT (dicomParser)      | believed de-identified (published test corpus) | fragmented / BOT permutations          |
| `packages/fixtures/testImages/encapsulated/multi-frame/CT0012.*` (10 files)  | [cornerstonejs/dicomParser](https://github.com/cornerstonejs/dicomParser) test corpus; JPEG / JPEG-LS / RLE variants of CT0012                                  | MIT (dicomParser)      | believed de-identified (published test corpus) | fragmented / BOT permutations          |
| `packages/fixtures/testImages/encapsulated/multi-frame/IM00001.*` (2 files)  | [cornerstonejs/dicomParser](https://github.com/cornerstonejs/dicomParser) test corpus                                                                           | MIT (dicomParser)      | believed de-identified (published test corpus) | JPEG baseline multi-frame              |

## Known unknowns

The committed files in `packages/fixtures/dicom/` predate this document;
their exact origins are still being traced. Tracing them (or replacing any that cannot
be traced with synthetic equivalents) is part of the planned
`@dcmjs-org/fixtures` work — see RELEASE_PLAN.md, section 6, step 2. Until a
file's row is complete, treat it as usable in tests here but not safe to
redistribute elsewhere.
