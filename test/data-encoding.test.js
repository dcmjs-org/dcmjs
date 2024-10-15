import "regenerator-runtime/runtime.js";

import { getZippedTestDataset } from "./testUtils.js";
import dcmjs from "../src/index.js";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

const { DicomMetaDictionary, DicomMessage } = dcmjs.data;

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
