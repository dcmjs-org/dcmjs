import {readFileSync, writeFileSync} from "fs";
import dcmjs from "../src/index.js";

const {DicomDict, DicomMessage, DicomMetaDictionary} = dcmjs.data;

function loadP10Buffer(path, readOptions) {
    readOptions = readOptions || {};
    const baseOptions = {ignoreErrors: true};
    readOptions = {...baseOptions, ...readOptions};

    const buffer = readFileSync(path);
    const dicomDict = DicomMessage.readFile(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        readOptions
    );
    const meta = DicomMetaDictionary.naturalizeDataset(dicomDict.meta);
    const elements = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);

    return {meta, elements};
}

function saveP10Buffer(path, meta, elements, writeOptions) {
    const denaturalizedMetaHeader = DicomMetaDictionary.denaturalizeDataset(meta);
    const dicomDict = new DicomDict(denaturalizedMetaHeader);
    dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(elements);

    writeFileSync(path, Buffer.from(dicomDict.write(writeOptions)));
}


describe('test', () => {
    test('test2', () => {
        // Load DICOM PDF file
        const {meta, elements} = loadP10Buffer('test/craig-test.dcm');

        console.log(meta, elements);

        // Save DICOM PDF file
        const dcmSavePath = 'craig-test-output.dcm';
        saveP10Buffer(dcmSavePath, meta, elements);

        // Load saved DICOM PDF file
        const {meta: meta2, elements: elements2} = loadP10Buffer(dcmSavePath);
        console.log(meta2, elements2);
    })
});
