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

    test('test DS value with additional allowed characters is written to file', () => {
        const dataset = {
            '00181041': {
                _rawValue: [" +1.4000  ", "-0.00", "1.2345e2", "1E34"],
                Value: [1.4, -0, 123.45, 1e+34],
                vr: 'DS'
            },
        };

        const dicomDict = new DicomDict({});
        dicomDict.dict = dataset;

        // write and re-read
        const outputDicomDict = DicomMessage.readFile(dicomDict.write());

        // expect raw value to be unchanged, and Value parsed as Number to lose precision
        expect(outputDicomDict.dict['00181041']._rawValue).toEqual([" +1.4000  ", "-0.00", "1.2345e2", "1E34"])
        expect(outputDicomDict.dict['00181041'].Value).toEqual([1.4, -0, 123.45, 1e+34])
    });

    test('test DS value that exceeds Number.MAX_SAFE_INTEGER is written to file', () => {
        const dataset = {
            '00181041': {
                _rawValue: ["9007199254740993"],
                Value: [9007199254740993],
                vr: 'DS'
            },
        };

        const dicomDict = new DicomDict({});
        dicomDict.dict = dataset;

        // write and re-read
        const outputDicomDict = DicomMessage.readFile(dicomDict.write());

        // expect raw value to be unchanged, and Value parsed as Number to lose precision
        expect(outputDicomDict.dict['00181041']._rawValue).toEqual(["9007199254740993"])
        expect(outputDicomDict.dict['00181041'].Value).toEqual([9007199254740992])
    });

    const unchangedTestCases = [
        {
            vr: "AE",
            _rawValue: ["  TEST_AE "], // spaces non-significant for interpretation but allowed
            Value: ["TEST_AE"],
        },
        {
            vr: "AS",
            _rawValue: ["045Y"],
            Value: ["045Y"],
        },
        {
            vr: "AT",
            _rawValue: [0x00207E14],
            Value: [0x00207E14],
        },
        {
            vr: "CS",
            _rawValue: ["ORIGINAL  ", " PRIMARY "], // spaces non-significant for interpretation but allowed
            Value: ["ORIGINAL", "PRIMARY"],
        },
        {
            vr: "DA",
            _rawValue: ["20240101"],
            Value: ["20240101"],
        },
        {
            vr: "DS",
            _rawValue: ["0000123.45"], // leading zeros allowed
            Value: [123.45],
        },
        {
            vr: 'DT',
            _rawValue: ["20240101123045.1  "], // trailing spaces allowed
            Value: ["20240101123045.1  "],
        },
        {
            vr: 'FL',
            _rawValue: [3.125],
            Value: [3.125],
        },
        {
            vr: 'FD',
            _rawValue: [3.14159265358979], // trailing spaces allowed
            Value: [3.14159265358979],
        },
        {
            vr: 'IS',
            _rawValue: [" -123   "], // leading/trailing spaces & sign allowed
            Value: [-123],
        },
        {
            vr: 'LO',
            _rawValue: [" A long string with spaces    "], // leading/trailing spaces allowed
            Value: ["A long string with spaces"],
        },
        {
            vr: 'LT',
            _rawValue: ["  It may contain the Graphic Character set and the Control Characters, CR\r, LF\n, FF\f, and ESC\x1b. "], // leading spaces significant, trailing spaces allowed
            Value: ["  It may contain the Graphic Character set and the Control Characters, CR\r, LF\n, FF\f, and ESC\x1b."],
        },
        {
            vr: 'OB',
            _rawValue: [new Uint8Array([0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88]).buffer],
            Value: [new Uint8Array([0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88]).buffer],
        },
        {
            vr: 'OD',
            _rawValue: [new Uint8Array([0x00, 0x00, 0x00, 0x54, 0x34, 0x6F, 0x9D, 0x41]).buffer],
            Value: [new Uint8Array([0x00, 0x00, 0x00, 0x54, 0x34, 0x6F, 0x9D, 0x41]).buffer],
        },
        {
            vr: 'OF',
            _rawValue: [new Uint8Array([0x00, 0x00, 0x28, 0x41, 0x00, 0x00, 0x30, 0xC0, 0x00, 0x00, 0xF6, 0x42]).buffer],
            Value: [new Uint8Array([0x00, 0x00, 0x28, 0x41, 0x00, 0x00, 0x30, 0xC0, 0x00, 0x00, 0xF6, 0x42]).buffer],
        },
        // TODO: VRs currently unimplemented
        // {
        //     vr: 'OL',
        //     _rawValue: [new Uint8Array([0x00, 0x00, 0x30, 0xC0, 0x00, 0x00, 0x28, 0x41, 0x00, 0x00, 0xF6, 0x42, 0x00, 0x00, 0x28, 0x41]).buffer],
        //     Value: [new Uint8Array([0x00, 0x00, 0x30, 0xC0, 0x00, 0x00, 0x28, 0x41, 0x00, 0x00, 0xF6, 0x42, 0x00, 0x00, 0x28, 0x41]).buffer],
        // },
        // {
        //     vr: 'OV',
        //     _rawValue: [new Uint8Array([0x00, 0x00, 0x30, 0xC0, 0x00, 0x00, 0x28, 0x41]).buffer],
        //     Value: [new Uint8Array([0x00, 0x00, 0x30, 0xC0, 0x00, 0x00, 0x28, 0x41]).buffer],
        // },
        {
            vr: 'OW',
            _rawValue: [new Uint8Array([0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88]).buffer],
            Value: [new Uint8Array([0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88]).buffer],
        },
        {
            vr: 'PN',
            _rawValue: ["Doe^John^A^Jr.^MD  "], // trailing spaces allowed
            Value: [{"Alphabetic": "Doe^John^A^Jr.^MD  "}],
        },
        {
            vr: 'SH',
            _rawValue: [" CT_SCAN_01 "], // leading/trailing spaces allowed
            Value: ["CT_SCAN_01"],
        },
        {
            vr: 'SL',
            _rawValue: [-2147483648],
            Value: [-2147483648],
        },
        {
            vr: 'SS',
            _rawValue: [-32768],
            Value: [-32768],
        },
        {
            vr: 'ST',
            _rawValue: ["Patient complains of headaches over the last week.    "], // trailing spaces allowed
            Value: ["Patient complains of headaches over the last week."],
        },
        // TODO: VR currently unimplemented
        // {
        //     vr: 'SV',
        //     _rawValue: [9007199254740993], // trailing spaces allowed
        //     Value: [9007199254740993],
        // },
        {
            vr: 'TM',
            _rawValue: ["42530.123456  "], // trailing spaces allowed
            Value: ["42530.123456"],
        },
        {
            vr: 'UC',
            _rawValue: ["Detailed description of procedure or clinical notes that could be very long.  "], // trailing spaces allowed
            Value: ["Detailed description of procedure or clinical notes that could be very long."],
        },
        {
            vr: 'UI',
            _rawValue: ["1.2.840.10008.1.2.1"],
            Value: ["1.2.840.10008.1.2.1"],
        },
        {
            vr: 'UL',
            _rawValue: [4294967295],
            Value: [4294967295],
        },
        {
            vr: 'UR',
            _rawValue: ["http://dicom.nema.org "], // trailing spaces ignored but allowed
            Value: ["http://dicom.nema.org "],
        },
        {
            vr: 'US',
            _rawValue: [65535],
            Value: [65535],
        },
        {
            vr: 'UT',
            _rawValue: ["    This is a detailed explanation that can span multiple lines and paragraphs in the DICOM dataset.  "], // leading spaces significant, trailing spaces allowed
            Value: ["    This is a detailed explanation that can span multiple lines and paragraphs in the DICOM dataset."],
        },
        // TODO: VR currently unimplemented
        // {
        //     vr: 'UV',
        //     _rawValue: [18446744073709551616], // 2^64
        //     Value: [18446744073709551616],
        // },
    ];

    test.each(unchangedTestCases)(
        `Test unchanged value is retained following read and write - $vr`,
        (dataElement) => {
            const dataset = {
                '00181041': {
                    ...dataElement
                },
            };

            const dicomDict = new DicomDict({});
            dicomDict.dict = dataset;

            // write and re-read
            const outputDicomDict = DicomMessage.readFile(dicomDict.write());

            // expect raw value to be unchanged, and Value parsed as Number to lose precision
            expect(outputDicomDict.dict['00181041']._rawValue).toEqual(dataElement._rawValue)
            expect(outputDicomDict.dict['00181041'].Value).toEqual(dataElement.Value)
        }
    )

    test('File dataset should be equal after read and write', async () => {
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
