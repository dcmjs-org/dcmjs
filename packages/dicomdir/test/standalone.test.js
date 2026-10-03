// packages/dicomdir/test/standalone.test.js
//
// The package's reason to exist is running without the legacy engines, so
// this file imports nothing from @dcmjs-org/legacy — jest gives each test
// file its own module registry, so no eager DicomMessage is ever wired into
// core's late-binding seam here. Writing a DICOMDIR serializes a
// DirectoryRecordSequence, which exercises core's sequence writer with no
// injected engine; before SequenceOfItems.writeBytes called back into
// writeDataSet directly, this write threw.

import { writeDicomDir } from "../src/index.js";

const MR_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.4";
const ELE = "1.2.840.10008.1.2.1";

function countItemTags(bytes) {
    // FFFE,E000 little-endian with the undefined-length marker the item
    // headers carry — anchoring on all eight bytes keeps value bytes from
    // matching by accident.
    let count = 0;
    for (let i = 0; i + 8 <= bytes.length; i++) {
        if (
            bytes[i] === 0xfe &&
            bytes[i + 1] === 0xff &&
            bytes[i + 2] === 0x00 &&
            bytes[i + 3] === 0xe0 &&
            bytes[i + 4] === 0xff &&
            bytes[i + 5] === 0xff &&
            bytes[i + 6] === 0xff &&
            bytes[i + 7] === 0xff
        ) {
            count++;
        }
    }
    return count;
}

test("writes a complete DICOMDIR with no eager engine loaded", () => {
    const arrayBuffer = writeDicomDir(
        [
            {
                referencedFileID: ["DICOM", "IM000001"],
                sopClassUid: MR_SOP_CLASS,
                sopInstanceUid: "1.2.3.4.100",
                transferSyntaxUid: ELE,
                patient: { PatientID: "998877", PatientName: "DOE^JANE" },
                study: { StudyInstanceUID: "1.2.3.4" },
                series: { SeriesInstanceUID: "1.2.3.4.5", Modality: "MR" },
                instance: { InstanceNumber: 1 }
            }
        ],
        { fileSetID: "MY_CD", fileSetUID: "2.25.99" }
    );
    const bytes = new Uint8Array(arrayBuffer);

    // Part 10 magic after the 128-byte preamble.
    expect(String.fromCharCode(...bytes.slice(128, 132))).toBe("DICM");
    // One entry yields PATIENT/STUDY/SERIES/IMAGE — four record items.
    expect(countItemTags(bytes)).toBe(4);
    // Deterministic under a fixed fileSetUID, same as the main suite.
    const again = new Uint8Array(
        writeDicomDir(
            [
                {
                    referencedFileID: ["DICOM", "IM000001"],
                    sopClassUid: MR_SOP_CLASS,
                    sopInstanceUid: "1.2.3.4.100",
                    transferSyntaxUid: ELE,
                    patient: { PatientID: "998877", PatientName: "DOE^JANE" },
                    study: { StudyInstanceUID: "1.2.3.4" },
                    series: { SeriesInstanceUID: "1.2.3.4.5", Modality: "MR" },
                    instance: { InstanceNumber: 1 }
                }
            ],
            { fileSetID: "MY_CD", fileSetUID: "2.25.99" }
        )
    );
    expect(again).toEqual(bytes);
});
