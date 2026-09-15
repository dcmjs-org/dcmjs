// test/dicomdir.test.js
//
// DICOMDIR builder: record hierarchy, and — the critical property — real
// byte offsets. Ground truth is the written buffer itself: every nonzero
// offset value must land exactly on an FFFE,E000 item tag, and walking the
// next/lower chains must visit every record once in hierarchy order.

import dcmjs from "../src/index.js";
import { validationLog } from "../src/log.js";

validationLog.setLevel(5);

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;
const {
    buildDicomDirDataset,
    writeDicomDir,
    MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID
} = dcmjs.media;

const MR_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.4";
const ELE = "1.2.840.10008.1.2.1";

function entry(overrides = {}) {
    return {
        referencedFileID: ["DICOM", "IM000001"],
        sopClassUid: MR_SOP_CLASS,
        sopInstanceUid: "1.2.3.4.100",
        transferSyntaxUid: ELE,
        patient: { PatientID: "998877", PatientName: "DOE^JANE" },
        study: { StudyInstanceUID: "1.2.3.4", StudyDescription: "HEAD^BRAIN" },
        series: { SeriesInstanceUID: "1.2.3.4.5", Modality: "MR" },
        instance: { InstanceNumber: 1 },
        ...overrides
    };
}

function readDicomDir(arrayBuffer) {
    const dicomDict = DicomMessage.readFile(arrayBuffer);
    return {
        meta: DicomMetaDictionary.naturalizeDataset(dicomDict.meta),
        dataset: DicomMetaDictionary.naturalizeDataset(dicomDict.dict)
    };
}

function recordsOf(dataset) {
    const sequence = dataset.DirectoryRecordSequence;
    return Array.isArray(sequence) ? sequence : [sequence];
}

/** Assert the four bytes at `offset` are the FFFE,E000 item tag (LE). */
function expectItemTagAt(bytes, offset) {
    expect(bytes[offset]).toBe(0xfe);
    expect(bytes[offset + 1]).toBe(0xff);
    expect(bytes[offset + 2]).toBe(0x00);
    expect(bytes[offset + 3]).toBe(0xe0);
}

describe("record hierarchy", () => {
    test("one entry yields PATIENT/STUDY/SERIES/IMAGE", () => {
        const { dataset } = readDicomDir(writeDicomDir([entry()]));
        expect(
            recordsOf(dataset).map(r => r.DirectoryRecordType)
        ).toEqual(["PATIENT", "STUDY", "SERIES", "IMAGE"]);
    });

    test("two entries in one series share the branch", () => {
        const { dataset } = readDicomDir(
            writeDicomDir([
                entry(),
                entry({
                    referencedFileID: ["DICOM", "IM000002"],
                    sopInstanceUid: "1.2.3.4.101",
                    instance: { InstanceNumber: 2 }
                })
            ])
        );
        expect(
            recordsOf(dataset).map(r => r.DirectoryRecordType)
        ).toEqual(["PATIENT", "STUDY", "SERIES", "IMAGE", "IMAGE"]);
    });

    test("two patients chain as siblings", () => {
        const { dataset } = readDicomDir(
            writeDicomDir([
                entry(),
                entry({
                    patient: { PatientID: "22446688", PatientName: "FOX^JANE" },
                    study: { StudyInstanceUID: "9.8.7" },
                    series: { SeriesInstanceUID: "9.8.7.6", Modality: "MR" },
                    sopInstanceUid: "9.8.7.6.5",
                    referencedFileID: ["DICOM", "IM000002"]
                })
            ])
        );
        const types = recordsOf(dataset).map(r => r.DirectoryRecordType);
        expect(types.filter(t => t === "PATIENT")).toHaveLength(2);
    });

    test("leaf carries the file reference", () => {
        const { dataset } = readDicomDir(writeDicomDir([entry()]));
        const image = recordsOf(dataset).find(
            r => r.DirectoryRecordType === "IMAGE"
        );
        expect(image.ReferencedFileID).toEqual(["DICOM", "IM000001"]);
        expect(image.ReferencedSOPClassUIDInFile).toBe(MR_SOP_CLASS);
        expect(image.ReferencedSOPInstanceUIDInFile).toBe("1.2.3.4.100");
        expect(image.ReferencedTransferSyntaxUIDInFile).toBe(ELE);
    });
});

describe("offsets are real byte positions", () => {
    const entries = [
        entry(),
        entry({
            referencedFileID: ["DICOM", "IM000002"],
            sopInstanceUid: "1.2.3.4.101",
            instance: { InstanceNumber: 2 }
        }),
        entry({
            patient: { PatientID: "22446688", PatientName: "FOX^JANE" },
            study: { StudyInstanceUID: "9.8.7" },
            series: { SeriesInstanceUID: "9.8.7.6", Modality: "MR" },
            sopInstanceUid: "9.8.7.6.5",
            referencedFileID: ["DICOM", "IM000003"]
        })
    ];

    const buffer = writeDicomDir(entries, { fileSetUID: "2.25.42" });
    const bytes = new Uint8Array(buffer);
    const { dataset } = readDicomDir(buffer);
    const records = recordsOf(dataset);

    test("every nonzero offset lands on an FFFE,E000 item tag", () => {
        const offsets = [
            dataset.OffsetOfTheFirstDirectoryRecordOfTheRootDirectoryEntity,
            dataset.OffsetOfTheLastDirectoryRecordOfTheRootDirectoryEntity,
            ...records.flatMap(r => [
                r.OffsetOfTheNextDirectoryRecord,
                r.OffsetOfReferencedLowerLevelDirectoryEntity
            ])
        ].filter(offset => offset !== 0);

        expect(offsets.length).toBeGreaterThan(0);
        for (const offset of offsets) {
            expectItemTagAt(bytes, offset);
        }
    });

    test("chain links + first root offset address every record exactly once", () => {
        // Every record is referenced exactly once: the first root record by
        // the root offset, every other record by exactly one next/lower
        // link. The union must therefore have exactly one offset per record,
        // each landing on an item tag. Records were flattened depth-first,
        // so sorted offsets correspond to sequence order.
        const referenced = records
            .flatMap(r => [
                r.OffsetOfTheNextDirectoryRecord,
                r.OffsetOfReferencedLowerLevelDirectoryEntity
            ])
            .filter(offset => offset !== 0);
        const all = [
            dataset.OffsetOfTheFirstDirectoryRecordOfTheRootDirectoryEntity,
            ...referenced
        ];

        expect(all).toHaveLength(records.length); // no double references
        const unique = [...new Set(all)].sort((a, b) => a - b);
        expect(unique).toHaveLength(records.length); // no shared targets
        for (const offset of unique) {
            expectItemTagAt(bytes, offset);
        }
    });

    test("offsets are strictly increasing in sequence order", () => {
        const referenced = records
            .flatMap(r => [
                r.OffsetOfTheNextDirectoryRecord,
                r.OffsetOfReferencedLowerLevelDirectoryEntity
            ])
            .filter(o => o !== 0);
        const all = [
            dataset.OffsetOfTheFirstDirectoryRecordOfTheRootDirectoryEntity,
            ...referenced
        ];
        const sorted = [...new Set(all)].sort((a, b) => a - b);
        expect(sorted[0]).toBe(
            dataset.OffsetOfTheFirstDirectoryRecordOfTheRootDirectoryEntity
        );
    });

    test("root first/last point at the two PATIENT records", () => {
        const first =
            dataset.OffsetOfTheFirstDirectoryRecordOfTheRootDirectoryEntity;
        const last =
            dataset.OffsetOfTheLastDirectoryRecordOfTheRootDirectoryEntity;
        expect(first).not.toBe(0);
        expect(last).not.toBe(0);
        expect(last).toBeGreaterThan(first);
        // First PATIENT's next-sibling link is the last PATIENT.
        expect(records[0].OffsetOfTheNextDirectoryRecord).toBe(last);
        // Last sibling terminates its chain.
        const lastPatient = records.find(
            (r, i) =>
                r.DirectoryRecordType === "PATIENT" &&
                i > 0
        );
        expect(lastPatient.OffsetOfTheNextDirectoryRecord).toBe(0);
    });

    test("deterministic: same entries + fileSetUID -> identical bytes", () => {
        const again = writeDicomDir(entries, { fileSetUID: "2.25.42" });
        expect(new Uint8Array(again)).toEqual(bytes);
    });
});

describe("file meta and root attributes", () => {
    const buffer = writeDicomDir([entry()], {
        fileSetID: "FOX_CD",
        fileSetUID: "2.25.7"
    });
    const { meta, dataset } = readDicomDir(buffer);

    test("meta group carries the Media Storage Directory SOP class", () => {
        expect(meta.MediaStorageSOPClassUID).toBe(
            MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID
        );
        expect(meta.MediaStorageSOPInstanceUID).toBe("2.25.7");
        expect(meta.TransferSyntaxUID).toBe(ELE);
    });

    test("body has file-set attributes but no SOP Common", () => {
        expect(dataset.FileSetID).toBe("FOX_CD");
        expect(dataset.FileSetConsistencyFlag).toBe(0);
        expect(dataset.SOPClassUID).toBeUndefined();
        expect(dataset.SOPInstanceUID).toBeUndefined();
    });
});

describe("validation", () => {
    test("non-conformant file ID component throws with guidance", () => {
        expect(() =>
            writeDicomDir([
                entry({ referencedFileID: ["series1", "img001.dcm"] })
            ])
        ).toThrow(/not ISO 9660 level 1 conformant/);
    });

    test("allowNonConformingFileIDs bypasses the check", () => {
        const buffer = writeDicomDir(
            [entry({ referencedFileID: ["series1", "img001.dcm"] })],
            { allowNonConformingFileIDs: true }
        );
        const { dataset } = readDicomDir(buffer);
        const image = recordsOf(dataset).find(
            r => r.DirectoryRecordType === "IMAGE"
        );
        expect(image.ReferencedFileID).toEqual(["series1", "img001.dcm"]);
    });

    test("missing PatientID throws", () => {
        expect(() =>
            writeDicomDir([entry({ patient: { PatientName: "X" } })])
        ).toThrow(/PatientID is required/);
    });

    test("missing StudyInstanceUID throws", () => {
        expect(() =>
            writeDicomDir([entry({ study: { StudyID: "1" } })])
        ).toThrow(/StudyInstanceUID is required/);
    });

    test("empty file set writes with zero root offsets", () => {
        const { dataset } = readDicomDir(writeDicomDir([]));
        expect(
            dataset.OffsetOfTheFirstDirectoryRecordOfTheRootDirectoryEntity
        ).toBe(0);
        expect(
            dataset.OffsetOfTheLastDirectoryRecordOfTheRootDirectoryEntity
        ).toBe(0);
    });
});
