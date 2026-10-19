# @dcmjs-org/dicomdir

DICOMDIR (Media Storage Directory, PS3.10 / PS3.3 Annex F) building and
writing — the index file at the root of patient CDs, DVDs, and USB media.

Give `writeDicomDir` a flat list of file-set entries (one per referenced
file) and it builds the PATIENT → STUDY → SERIES → leaf directory record
hierarchy, computes the real byte offsets that link the records
(`OffsetOfTheNextDirectoryRecord`,
`OffsetOfReferencedLowerLevelDirectoryEntity`, and the root first/last
record offsets), and serializes the complete Part 10 file in a single
pass — no patch-and-rewrite, no buffer scanning.

Grouping is automatic and unbounded: entries are bucketed by `PatientID`,
then `StudyInstanceUID`, then `SeriesInstanceUID`, so any mix of patients,
studies, and series on one piece of media comes out as the correct tree
with sibling records chained at every level. The media below carries two
patients — one with two studies — and the records land as

```
PATIENT DOE^JANE ─ STUDY 1.2.3.4 ─ SERIES MR ─ IMAGE IM000001
                 └ STUDY 1.2.9.9 ─ SERIES CT ─ IMAGE IM000002
PATIENT FOX^SAM  ─ STUDY 5.6.7.8 ─ SERIES US ─ IMAGE IM000003
```

```js
import { writeDicomDir } from "@dcmjs-org/dicomdir";

const mr = {
    referencedFileID: ["DICOM", "IM000001"],
    sopClassUid: "1.2.840.10008.5.1.4.1.1.4",
    sopInstanceUid: "1.2.3.4.100",
    transferSyntaxUid: "1.2.840.10008.1.2.1",
    patient: { PatientID: "998877", PatientName: "DOE^JANE" },
    study: { StudyInstanceUID: "1.2.3.4" },
    series: { SeriesInstanceUID: "1.2.3.4.5", Modality: "MR" },
    instance: { InstanceNumber: 1 }
};

// Same patient, second study.
const ct = {
    ...mr,
    referencedFileID: ["DICOM", "IM000002"],
    sopClassUid: "1.2.840.10008.5.1.4.1.1.2",
    sopInstanceUid: "1.2.9.9.100",
    study: { StudyInstanceUID: "1.2.9.9" },
    series: { SeriesInstanceUID: "1.2.9.9.1", Modality: "CT" }
};

// Different patient entirely.
const us = {
    ...mr,
    referencedFileID: ["DICOM", "IM000003"],
    sopClassUid: "1.2.840.10008.5.1.4.1.1.6.1",
    sopInstanceUid: "5.6.7.8.100",
    patient: { PatientID: "112233", PatientName: "FOX^SAM" },
    study: { StudyInstanceUID: "5.6.7.8" },
    series: { SeriesInstanceUID: "5.6.7.8.1", Modality: "US" }
};

const arrayBuffer = writeDicomDir([mr, ct, us], { fileSetID: "MY_CD" });
```

`buildDicomDirDataset` exposes the record tree before serialization (all
offsets zero) for inspection or customization.

The package covers building and writing. Reading a DICOMDIR needs no
dedicated API — it is an ordinary Part 10 file, so either engine returns
the records as `DirectoryRecordSequence` — but there is no convenience
walker or QIDO-style query surface over those records yet; that follow-up
is tracked in
[#611](https://github.com/dcmjs-org/dcmjs/issues/611).

Depends only on `@dcmjs-org/core`.
