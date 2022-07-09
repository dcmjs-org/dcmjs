import "regenerator-runtime/runtime.js";

import { jest } from "@jest/globals";
import { getZippedTestDataset } from "./testUtils.js";
import dcmjs from "../src/index.js";
import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";

const {
    DicomMetaDictionary,
    DicomDict,
    DicomMessage,
    ReadBufferStream
} = dcmjs.data;

const expectedPatientNames = {
  "SCSARAB": "قباني^لنزار",
  "SCSFREN": "Buc^Jérôme",
  "SCSGERM": "Äneas^Rüdiger",
  "SCSGREEK": "Διονυσιος",
  "SCSHBRW": "שרון^דבורה",
  "SCSRUSS": "Люкceмбypг",
  "SCSX1": "Wang^XiaoDong=王^小東=",
  "SCSX2": "Wang^XiaoDong=王^小东=",
  // These are not yet supported, because they use multiple encodings, which would require a more complex parser...
  //"SCSH31": "Yamada^Tarou=\u001b$B;3ED\u001b(B^\u001b$BB@O:\u001b(B=\u001b$B$d$^$@\u001b(B^\u001b$B$?$m$&\u001b(B",
  //"SCSH32": "ÔÏÀÞ^ÀÛ³=\u001b$B;3ED\u001b(J^\u001b$BB@O:\u001b(J=\u001b$B$d$^$@\u001b(J^\u001b$B$?$m$&\u001b(J",
  //"SCSI2": "Hong^Gildong=\u001b$)Cûó^\u001b$)CÑÎÔ×=\u001b$)CÈ«^\u001b$)C±æµ¿",
}

it.only("test_encodings", async () => {
    return 
    const url = "https://github.com/dcmjs-org/data/releases/download/dclunie-charsets/dclunie-charsets.zip"
    const unzipPath = await getZippedTestDataset(url, "dclunie-charsets.zip", "dclunie-charsets");
    const filesPath = unzipPath + "/charsettests"
    const fileNames = await fsPromises.readdir(filesPath);

    fileNames.forEach(fileName => {
        if (fileName in expectedPatientNames) {
          const arrayBuffer = fs.readFileSync(path.join(filesPath, fileName))
            .buffer;
          const dicomDict = DicomMessage.readFile(arrayBuffer);
          const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
          expect(dataset.PatientName).toEqual(expectedPatientNames[fileName]); 
          
          // write to memory and expect correctly loaded utf-8 DICOM
          const newDicomDict = DicomMessage.readFile(dicomDict.write());
          const newDataset = DicomMetaDictionary.naturalizeDataset(newDicomDict.dict);
          expect(newDataset.PatientName).toEqual(expectedPatientNames[fileName]);
          expect(newDataset.SpecificCharacterSet).toEqual('ISO_IR 192');
        }
    });
});
