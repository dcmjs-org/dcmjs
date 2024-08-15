import "regenerator-runtime/runtime.js";

import fs from "fs";
import path from "path";
import dcmjs from "../src/index.js";
import {deepEqual} from "../src/utilities/deepEqual";

import {getTestDataset, getZippedTestDataset} from "./testUtils";

const { DicomMetaDictionary, DicomDict, DicomMessage, ReadBufferStream } =
    dcmjs.data;

// export const PIXEL_DATA_HEX_TAG = '7FE00010';
//
// // compare files at binary level
// const compareArrayBuffers = (buf1, buf2) => {
//     const dv1 = new Int8Array(buf1);
//     const dv2 = new Int8Array(buf2);
//     for (let i = 0; i < buf1.byteLength; i += 1) {
//         if (dv1[i] !== dv2[i]) {
//             return false;
//         }
//     }
//     if (buf1.byteLength !== buf2.byteLength) return false;
//     return true;
// };

describe('lossless-read-write', () => {
    // test('reading and writing a file should not change the underlying data', async () => {
    //     // const url = "https://github.com/dcmjs-org/data/releases/download/encapsulation/encapsulation.dcm";
    //     // const dcmPath = await getTestDataset(url, "encapsulation.dcm");
    //
    //     const inputBuffer = fs.readFileSync("test/terumo.dcm").buffer;
    //
    //     // given
    //     // const inputBuffer = fs.readFileSync(dcmPath).buffer;
    //     const dicomDict = DicomMessage.readFile(inputBuffer);
    //
    //     const outputBuffer = dicomDict.write({ fragmentMultiframe: true, allowInvalidVRLength: false });
    //     const outputDicomDict = DicomMessage.readFile(outputBuffer);
    //
    //
    //
    //     fs.writeFile(`terumo-dcmjs-multifragment.dcm`, Buffer.from(outputBuffer), function (err) {
    //         if (err) {
    //             return console.log(err);
    //         }
    //         console.log("The file was saved!");
    //     });
    //
    //     expect(
    //         compareArrayBuffers(
    //             dicomDict.dict[PIXEL_DATA_HEX_TAG].Value[0],
    //             outputDicomDict.dict[PIXEL_DATA_HEX_TAG].Value[0]
    //         )
    //     ).toEqual(true);
    //
    //     expect(compareArrayBuffers(inputBuffer, outputBuffer)).toEqual(true);
    // });

    test('test', async () => {
        const inputBuffer = await getDcmjsDataFile("unknown-VR", "sample-dicom-with-un-vr.dcm");
        const dicomDict = DicomMessage.readFile(inputBuffer);

        // confirm raw string representation of DS contains extra additional metadata
        // represented by bytes [30 2E 31 34 30 5C 30 2E 31 34 30 20]
        expect(dicomDict.dict['00280030']._rawValue).toEqual(["0.140", "0.140 "])
        expect(dicomDict.dict['00280030'].Value).toEqual([0.14, 0.14])

        // confirm after write raw values are re-encoded
        const outputBuffer = dicomDict.write();
        const outputDicomDict = DicomMessage.readFile(outputBuffer);

        // explicitly verify for DS for clarity
        expect(outputDicomDict.dict['00280030']._rawValue).toEqual(["0.140", "0.140 "])
        expect(outputDicomDict.dict['00280030'].Value).toEqual([0.14, 0.14])

        // lossless read/write should match entire data set
        deepEqual(dicomDict.dict, outputDicomDict.dict)
    });
});

const getDcmjsDataFile = async (release, fileName) => {
    const url = "https://github.com/dcmjs-org/data/releases/download/" + release + "/" + fileName;
    const dcmPath = await getTestDataset(url, fileName);

    return fs.readFileSync(dcmPath).buffer;
}
