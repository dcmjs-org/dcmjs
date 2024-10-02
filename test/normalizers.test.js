import "regenerator-runtime/runtime.js";

import fs from "fs";
import { jest } from "@jest/globals";
import { DicomMessage } from "../src/DicomMessage";
import { DicomMetaDictionary } from "../src/DicomMetaDictionary";
import dcmjs from "../src";

// The asset downloads in this file might take some time on a slower connection
jest.setTimeout(60000);

it("test_normalizer_op", async () => {
    const file = fs.readFileSync('test/sample-op.dcm');
    const dicomDict = DicomMessage.readFile(file.buffer);

    const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
    const multiframe = dcmjs.normalizers.Normalizer.normalizeToDataset([dataset]);

    expect(dataset.NumberOfFrames).toEqual(1);
    expect(multiframe.NumberOfFrames).toEqual(1);
});