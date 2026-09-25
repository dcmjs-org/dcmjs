import { getZippedTestDataset } from "./testUtils.js";
import dcmjs from "../src/index.js";
import fs from "fs";
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
            const arrayBuffer = fs.readFileSync(
                path.join(filesPath, fileName)
            ).buffer;
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
