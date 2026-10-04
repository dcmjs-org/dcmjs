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

```js
import { writeDicomDir } from "@dcmjs-org/dicomdir";

const arrayBuffer = writeDicomDir(
    [
        {
            referencedFileID: ["DICOM", "IM000001"],
            sopClassUid: "1.2.840.10008.5.1.4.1.1.4",
            sopInstanceUid: "1.2.3.4.100",
            transferSyntaxUid: "1.2.840.10008.1.2.1",
            patient: { PatientID: "998877", PatientName: "DOE^JANE" },
            study: { StudyInstanceUID: "1.2.3.4" },
            series: { SeriesInstanceUID: "1.2.3.4.5", Modality: "MR" },
            instance: { InstanceNumber: 1 }
        }
    ],
    { fileSetID: "MY_CD" }
);
```

`buildDicomDirDataset` exposes the record tree before serialization (all
offsets zero) for inspection or customization.

Depends only on `@dcmjs-org/core`.
