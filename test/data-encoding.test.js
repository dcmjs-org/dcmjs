import { getZippedTestDataset } from "./testUtils.js";
import dcmjs from "../src/index.js";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { defaultDICOMEncoding } from "../src/constants/encodings";
import { selectDICOMEncoding } from "../src/utilities/selectEncoding";

const { DicomMetaDictionary, DicomMessage } = dcmjs.data;

const testEncodingItems = [
    "utf8",
    "multiple",
    "one",
    "none"
];

const testEncodings = {
    utf8: [defaultDICOMEncoding],
    multiple: ["ISO_IR 13", "ISO_IR 166"],
    one: ["ISO_IR 6"],
    none: []
};

const expectedEncodings = {
    utf8: defaultDICOMEncoding,
    multiple: "ISO_IR 13",
    one: "ISO_IR 6",
    none: defaultDICOMEncoding
};

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

it("test_encoding_selection", async () => {
    testEncodingItems.forEach(item => {
        const encoding = selectDICOMEncoding(testEncodings[item], true);
        const expected = expectedEncodings[item];
        expect(encoding).toEqual(expected);
    });
});

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
            expect(newDataset.SpecificCharacterSet).toEqual(
                defaultDICOMEncoding
            );
        }
    });
});
