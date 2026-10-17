import { getZippedTestDataset, readFileAsArrayBuffer } from "./testUtils.js";
import dcmjs from "../src/index.js";
import fsPromises from "fs/promises";
import path from "path";

const { DicomDict, DicomMetaDictionary, DicomMessage } = dcmjs.data;

const expectedPatientNames = {
    SCSARAB: "قباني^لنزار",
    SCSFREN: "Buc^Jérôme",
    SCSGERM: "Äneas^Rüdiger",
    SCSGREEK: "Διονυσιος",
    SCSHBRW: "שרון^דבורה",
    SCSRUSS: "Люкceмбypг",
    SCSX1: "Wang^XiaoDong=王^小東", // Trailing "=" gets stripped, as is permitted by the spec
    SCSX2: "Wang^XiaoDong=王^小东" // idem
    // These are not yet supported, because they use multiple encodings, which would require a more complex parser...
    //"SCSH31": "X",
    //"SCSH32": "X",
    //"SCSI2": "X",
};

it("test_encodings", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/dclunie-charsets/dclunie-charsets.zip";
    const unzipPath = await getZippedTestDataset(
        url,
        "dclunie-charsets.zip",
        "dclunie-charsets"
    );
    const filesPath = unzipPath + "/charsettests";
    const fileNames = await fsPromises.readdir(filesPath);

    fileNames.forEach(fileName => {
        if (fileName in expectedPatientNames) {
            const arrayBuffer = readFileAsArrayBuffer(
                path.join(filesPath, fileName)
            );
            const dicomDict = DicomMessage.readFile(arrayBuffer);
            const dataset = DicomMetaDictionary.naturalizeDataset(
                dicomDict.dict
            );
            expect(String(dataset.PatientName)).toEqual(
                expectedPatientNames[fileName]
            );

            // write to memory and expect correctly loaded utf-8 DICOM
            const newDicomDict = DicomMessage.readFile(dicomDict.write());
            const newDataset = DicomMetaDictionary.naturalizeDataset(
                newDicomDict.dict
            );
            expect(String(newDataset.PatientName)).toEqual(
                expectedPatientNames[fileName]
            );
            expect(newDataset.SpecificCharacterSet).toEqual("ISO_IR 192");
        }
    });
});

describe("SpecificCharacterSet in data read from sub-streams", () => {
    const text = "lesione – café 肝";

    function writeAndRead(dict) {
        const dicomDict = new DicomDict({
            "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] }
        });
        dicomDict.dict = dict;
        return DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(dicomDict.write()).dict
        );
    }

    it("decodes text in sequence items at every depth", () => {
        const dataset = writeAndRead(
            DicomMetaDictionary.denaturalizeDataset({
                SpecificCharacterSet: "ISO_IR 192",
                SOPClassUID: "1.2.840.10008.5.1.4.1.1.88.33",
                SOPInstanceUID: "1.2.3",
                StudyDescription: text,
                ValueType: "CONTAINER",
                ContentSequence: [
                    {
                        RelationshipType: "CONTAINS",
                        ValueType: "TEXT",
                        TextValue: text,
                        ContentSequence: [
                            {
                                RelationshipType: "CONTAINS",
                                ValueType: "TEXT",
                                TextValue: text
                            }
                        ]
                    }
                ]
            })
        );

        expect(dataset.StudyDescription).toEqual(text);
        expect(dataset.ContentSequence[0].TextValue).toEqual(text);
        expect(dataset.ContentSequence[0].ContentSequence[0].TextValue).toEqual(
            text
        );
    });

    it("decodes text in UN elements read with their dictionary VR", () => {
        const dict = DicomMetaDictionary.denaturalizeDataset({
            SpecificCharacterSet: "ISO_IR 192",
            SOPClassUID: "1.2.840.10008.5.1.4.1.1.7",
            SOPInstanceUID: "1.2.3"
        });
        // StudyDescription is LO in the dictionary, stored here with explicit VR UN.
        // The bytes are the LO value, padded to even length with a space.
        dict["00081030"] = {
            vr: "UN",
            Value: [new TextEncoder().encode(`${text} `).buffer]
        };

        expect(writeAndRead(dict).StudyDescription).toEqual(text);
    });
});

describe("SpecificCharacterSet declared in a sequence item", () => {
    // PS3.5 7.5.3: a Specific Character Set in an item applies only to that
    // item, and the items nested in it; an item without one uses the
    // character set of the data set that contains it.
    //
    // A worklist-shaped data set in ISO_IR 192 whose first scheduled step
    // declares ISO_IR 144 (ISO 8859-5, Cyrillic). dcmjs always writes UTF-8,
    // so that item's text is written as ASCII placeholders of the same length
    // and then replaced with its ISO 8859-5 bytes.
    const cyrillicName = "Иванов^Петр";
    const cyrillicMeaning = "Рентген";
    const latinName = "Dupré^Anaïs";
    const reason = "Contrôle après opération";

    // ISO 8859-5 keeps ASCII and puts А..я (U+0410..U+044F) at 0xB0..0xEF.
    const iso8859_5 = value =>
        Uint8Array.from(value, c => {
            const code = c.codePointAt(0);
            return code < 0x80 ? code : code - 0x360;
        });

    function replaceBytes(data, placeholder, bytes) {
        const needle = new TextEncoder().encode(placeholder);
        const at = data.findIndex((_, i) =>
            needle.every((byte, j) => data[i + j] === byte)
        );
        expect(at).toBeGreaterThan(-1);
        data.set(bytes, at);
    }

    function worklistPart10() {
        const dicomDict = new DicomDict({
            "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] }
        });
        dicomDict.dict = DicomMetaDictionary.denaturalizeDataset({
            SpecificCharacterSet: "ISO_IR 192",
            PatientName: latinName,
            ScheduledProcedureStepSequence: [
                {
                    SpecificCharacterSet: "ISO_IR 144",
                    ScheduledPerformingPhysicianName: "QQQQQQ^QQQQ",
                    ScheduledProtocolCodeSequence: [
                        {
                            CodeValue: "XR",
                            CodingSchemeDesignator: "99LOCAL",
                            CodeMeaning: "WWWWWWW"
                        }
                    ]
                },
                { ScheduledPerformingPhysicianName: latinName }
            ],
            ReasonForTheRequestedProcedure: reason
        });
        const data = new Uint8Array(dicomDict.write());
        replaceBytes(data, "QQQQQQ^QQQQ", iso8859_5(cyrillicName));
        replaceBytes(data, "WWWWWWW", iso8859_5(cyrillicMeaning));
        return data.buffer;
    }

    // One comparison, so a failure shows every value read in the wrong
    // character set at once.
    function expectEachItemInItsCharacterSet(dataset) {
        const [own, inherited] = dataset.ScheduledProcedureStepSequence;
        expect({
            patientName: dataset.PatientName[0].Alphabetic,
            ownItemName: own.ScheduledPerformingPhysicianName[0].Alphabetic,
            nestedItemMeaning: own.ScheduledProtocolCodeSequence[0].CodeMeaning,
            nextItemName:
                inherited.ScheduledPerformingPhysicianName[0].Alphabetic,
            afterSequence: dataset.ReasonForTheRequestedProcedure
        }).toEqual({
            patientName: latinName,
            ownItemName: cyrillicName,
            nestedItemMeaning: cyrillicMeaning,
            nextItemName: latinName,
            afterSequence: reason
        });
    }

    it("builds the item's text in ISO 8859-5", () => {
        expect(
            new TextDecoder("iso-8859-5").decode(iso8859_5(cyrillicName))
        ).toEqual(cyrillicName);
    });

    it("applies only to that item and the items nested in it", () => {
        expectEachItemInItsCharacterSet(
            DicomMetaDictionary.naturalizeDataset(
                DicomMessage.readFile(worklistPart10()).dict
            )
        );
    });
});
