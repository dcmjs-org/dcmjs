import "regenerator-runtime/runtime.js";

import fs from "fs";
import dcmjs from "../src/index.js";
import { deepEqual } from "../src/utilities/deepEqual";

import { getTestDataset } from "./testUtils";

const { DicomDict, DicomMessage } = dcmjs.data;


describe('lossless-read-write', () => {

    describe('storeRaw option', () => {
        const dataset = {
            '00080008': {
                vr: "CS",
                Value: ["DERIVED"],
            },
            "00082112": {
                vr: "SQ",
                Value: [
                    {
                        "00081150": {
                            vr: "UI",
                            Value: [
                                "1.2.840.10008.5.1.4.1.1.7"
                            ],
                        },
                    }
                ]
            },
            "00180050": {
                vr: "DS",
                Value: [1],
            },
            "00181708": {
                vr: "IS",
                Value: [426],
            },
            "00189328": {
                vr: "FD",
                Value: [30.98],
            },
            "0020000D": {
                vr: "UI",
                Value: ["1.3.6.1.4.1.5962.99.1.2280943358.716200484.1363785608958.3.0"],
            },
            "00400254": {
                vr: "LO",
                Value: ["DUCTO/GALACTOGRAM 1 DUCT LT"],
            },
            "7FE00010": {
                vr: "OW",
                Value: [new Uint8Array([0x00, 0x00]).buffer]
            }
        };

        test('storeRaw flag on VR should be respected by read', () => {
            const tagsWithoutRaw = ['00082112', '7FE00010'];

            const dicomDict = new DicomDict({});
            dicomDict.dict = dataset;

            // write and re-read
            const outputDicomDict = DicomMessage.readFile(dicomDict.write());
            for (const tag in outputDicomDict.dict) {
                if (tagsWithoutRaw.includes(tag)) {
                    expect(outputDicomDict.dict[tag]._rawValue).toBeFalsy();
                } else {
                    expect(outputDicomDict.dict[tag]._rawValue).toBeTruthy();
                }
            }
        });

        test('forceStoreRaw read option should override VR setting', () => {
            const tagsWithoutRaw = ['00082112', '7FE00010'];

            const dicomDict = new DicomDict({});
            dicomDict.dict = dataset;

            // write and re-read
            const outputDicomDict = DicomMessage.readFile(dicomDict.write(), {forceStoreRaw: true});

            for (const tag in outputDicomDict.dict) {
                expect(outputDicomDict.dict[tag]._rawValue).toBeTruthy();
            }
        });
    });

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

    test('test DS with multiplicity > 1 and added space for even padding is read and written correctly', () => {
        const dataset = {
            '00200037': {
                vr: 'DS',
                Value: [0.99924236548978, -0.0322633220972, -0.0217663285287, 0.02949870928067, 0.99267261121054, -0.1171789789306]
            }
        };

        const dicomDict = new DicomDict({});
        dicomDict.dict = dataset;

        // write and re-read
        const outputDicomDict = DicomMessage.readFile(dicomDict.write());

        // ensure _rawValue strings have no added trailing spaces
        const expectedDataset = {
            '00200037': {
                vr: 'DS',
                Value: [0.99924236548978, -0.0322633220972, -0.0217663285287, 0.02949870928067, 0.99267261121054, -0.1171789789306],
                _rawValue: ["0.99924236548978", "-0.0322633220972", "-0.0217663285287", "0.02949870928067", "0.99267261121054", "-0.1171789789306"]
            }
        };

        expect(deepEqual(expectedDataset, outputDicomDict.dict)).toBeTruthy();

        // re-write should succeeed
        const outputDicomDictPass2 = DicomMessage.readFile(outputDicomDict.write());

        // dataset should still be equal
        expect(deepEqual(expectedDataset, outputDicomDictPass2.dict)).toBeTruthy();
    });

    test('test DS with multiplicity > 1 with padding byte on last element within VR max length is losslessly read', () => {
        const dataset = {
            '00200037': {
                vr: 'DS',
                Value: [0.99924236548978, -0.0322633220972, -0.0217663285287, 0],
                _rawValue: ["0.99924236548978", "-0.0322633220972", "-0.0217663285287", " +0.00 "]
            }
        };

        const dicomDict = new DicomDict({});
        dicomDict.dict = dataset;

        // write and re-read
        const outputDicomDict = DicomMessage.readFile(dicomDict.write());

        // ensure _rawValue strings have no added trailing spaces and retain original encoding details for + and spaces
        const expectedDataset = {
            '00200037': {
                vr: 'DS',
                Value: [0.99924236548978, -0.0322633220972, -0.0217663285287, 0],
                _rawValue: ["0.99924236548978", "-0.0322633220972", "-0.0217663285287", " +0.00"]
            }
        };

        expect(outputDicomDict.dict).toEqual(expectedDataset);

        // re-write should succeeed
        const outputDicomDictPass2 = DicomMessage.readFile(outputDicomDict.write());

        // dataset should still be equal
        expect(outputDicomDictPass2.dict).toEqual(expectedDataset);
    });

    test('test IS with multiplicity > 1 and added space for even padding is read and written correctly', () => {
        const dataset = {
            '00081160': {
                vr: 'IS',
                Value: [1234, 5678]
            }
        };

        const dicomDict = new DicomDict({});
        dicomDict.dict = dataset;

        // write and re-read
        const outputDicomDict = DicomMessage.readFile(dicomDict.write());

        // last _rawValue strings does allow trailing space as it does not exceed max length
        const expectedDataset = {
            '00081160': {
                vr: 'IS',
                Value: [1234, 5678],
                _rawValue: ["1234", "5678"]
            }
        };

        expect(outputDicomDict.dict).toEqual(expectedDataset);

        // re-write should succeeed
        const outputDicomDictPass2 = DicomMessage.readFile(outputDicomDict.write());

        // dataset should still be equal
        expect(outputDicomDictPass2.dict).toEqual(expectedDataset);
    });

    describe('Multiplicity for non-binary String VRs', () => {
        const maxLengthCases = [
            {
                vr: 'AE',
                Value: ["MAX_LENGTH_CHARS", "MAX_LENGTH_CHARS"],
                _rawValue: ["MAX_LENGTH_CHARS", "MAX_LENGTH_CHARS"]
            },
            {
                vr: 'AS',
                Value: ["120D", "045Y"],
                _rawValue: ["120D", "045Y"]
            },
            {
                vr: 'AT',
                Value: [0x00207E14, 0x0012839A],
                _rawValue: [0x00207E14, 0x0012839A],
            },
            {
                vr: 'CS',
                Value: ["MAX_LENGTH_CHARS", "MAX_LENGTH_CHARS"],
                _rawValue: ["MAX_LENGTH_CHARS", "MAX_LENGTH_CHARS"]
            },
            {
                vr: 'DA',
                Value: ["20230826", "20230826"],
                _rawValue: ["20230826", "20230826"]
            },
            {
                vr: 'DS',
                Value: [123456789012.345, 123456789012.345],
                _rawValue: ["123456789012.345", "123456789012.345"]
            },
            {
                vr: 'DT',
                Value: ["20230826123045.123456+0100", "20230826123045.123456+0100"],
                _rawValue: ["20230826123045.123456+0100", "20230826123045.123456+0100"]
            },
            {
                vr: 'IS',
                Value: [123456789012, 123456789012],
                _rawValue: ["123456789012", "123456789012"]
            },
            {
                vr: 'LO',
                Value: ["ABCDEFGHIJKLMNOPQRSTUVWXABCDEFGHIJKLMNOPQRSTUVWXABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOPQRSTUVWXABCDEFGHIJKLMNOPQRSTUVWXABCDEFGHIJKLMNOP"],
                _rawValue: ["ABCDEFGHIJKLMNOPQRSTUVWXABCDEFGHIJKLMNOPQRSTUVWXABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOPQRSTUVWXABCDEFGHIJKLMNOPQRSTUVWXABCDEFGHIJKLMNOP"]
            },
            {
                vr: 'SH',
                Value: ["ABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOP"],
                _rawValue: ["ABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOP"]
            },
            {
                vr: 'UI',
                Value: ["1.2.840.12345678901234567890123456789012345678901234567890123456", "1.2.840.12345678901234567890123456789012345678901234567890123456"],
                _rawValue: ["1.2.840.12345678901234567890123456789012345678901234567890123456", "1.2.840.12345678901234567890123456789012345678901234567890123456"]
            },
            {
                vr: 'TM',
                Value: ["142530.1234567", "142530.1234567"],
                _rawValue: ["142530.1234567", "142530.1234567"],
            },

        ];

        test.each(maxLengthCases)(
            `Test multiple values with VR max length handle pad byte correctly during read and write - $vr`,
            (dataElement) => {
                const dataset = {
                    '00081160': {
                        vr: dataElement.vr,
                        Value: dataElement.Value,
                    }
                };

                const dicomDict = new DicomDict({});
                dicomDict.dict = dataset;

                // write and re-read
                const outputDicomDict = DicomMessage.readFile(dicomDict.write());

                // expect full _rawValue to match following read
                const expectedDataset = {
                    '00081160': {
                        ...dataElement,
                    }
                };

                expect(outputDicomDict.dict).toEqual(expectedDataset);

                // re-write should succeed without max length issues
                const outputDicomDictPass2 = DicomMessage.readFile(outputDicomDict.write());

                // dataset should still be equal
                expect(expectedDataset).toEqual(outputDicomDictPass2.dict);
            }
        );
    })

    describe('Individual VR comparisons', () => {

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
                _rawValue: [0x00207E14, 0x0012839A],
                Value: [0x00207E14, 0x0012839A],
            },
            {
                vr: "CS",
                _rawValue: ["ORIGINAL  ", " PRIMARY"], // spaces non-significant for interpretation but allowed
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
                _rawValue: [-32768, 1234, 832],
                Value: [-32768, 1234, 832],
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
                const outputDicomDict = DicomMessage.readFile(dicomDict.write(), {forceStoreRaw: true});

                // expect raw value to be unchanged, and Value parsed as Number to lose precision
                expect(outputDicomDict.dict['00181041']._rawValue).toEqual(dataElement._rawValue)
                expect(outputDicomDict.dict['00181041'].Value).toEqual(dataElement.Value)
            }
        )

        const changedTestCases = [
            {
                vr: "AE",
                _rawValue: ["  TEST_AE "], // spaces non-significant for interpretation but allowed
                Value: ["NEW_AE"],
            },
            {
                vr: "AS",
                _rawValue: ["045Y"],
                Value: ["999Y"],
            },
            {
                vr: "AT",
                _rawValue: [0x00207E14, 0x0012839A],
                Value: [0x00200010],
            },
            {
                vr: "CS",
                _rawValue: ["ORIGINAL  ", " PRIMARY "], // spaces non-significant for interpretation but allowed
                Value: ["ORIGINAL", "PRIMARY", "SECONDARY"],
            },
            {
                vr: "DA",
                _rawValue: ["20240101"],
                Value: ["20231225"],
            },
            {
                vr: "DS",
                _rawValue: ["0000123.45"], // leading zeros allowed
                Value: [123.456],
                newRawValue: ["123.456 "]
            },
            {
                vr: 'DT',
                _rawValue: ["20240101123045.1  "], // trailing spaces allowed
                Value: ["20240101123045.3"],
            },
            {
                vr: 'FL',
                _rawValue: [3.125],
                Value: [22],
            },
            {
                vr: 'FD',
                _rawValue: [3.14159265358979], // trailing spaces allowed
                Value: [50.1242],
            },
            {
                vr: 'IS',
                _rawValue: [" -123   "], // leading/trailing spaces & sign allowed
                Value: [0],
                newRawValue: ["0 "]
            },
            {
                vr: 'LO',
                _rawValue: [" A long string with spaces    "], // leading/trailing spaces allowed
                Value: ["A changed string that is still long."],
            },
            {
                vr: 'LT',
                _rawValue: ["  It may contain the Graphic Character set and the Control Characters, CR\r, LF\n, FF\f, and ESC\x1b. "], // leading spaces significant, trailing spaces allowed
                Value: [" A modified string of text"],
            },
            {
                vr: 'OB',
                _rawValue: [new Uint8Array([0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88]).buffer],
                Value: [new Uint8Array([0x01, 0x02]).buffer],
            },
            {
                vr: 'OD',
                _rawValue: [new Uint8Array([0x00, 0x00, 0x00, 0x54, 0x34, 0x6F, 0x9D, 0x41]).buffer],
                Value: [new Uint8Array([0x00, 0x00, 0x00, 0x54, 0x35, 0x6E, 0x9E, 0x42]).buffer],
            },
            {
                vr: 'OF',
                _rawValue: [new Uint8Array([0x00, 0x00, 0x28, 0x41, 0x00, 0x00, 0x30, 0xC0, 0x00, 0x00, 0xF6, 0x42]).buffer],
                Value: [new Uint8Array([0x00, 0x00, 0x28, 0x41, 0x00, 0x00, 0x30, 0xC0, 0x00, 0x00, 0xF6, 0x43]).buffer],
            },
            // TODO: VRs currently unimplemented
            // {
            //     vr: 'OL',
            //     _rawValue: [new Uint8Array([0x00, 0x00, 0x30, 0xC0, 0x00, 0x00, 0x28, 0x41, 0x00, 0x00, 0xF6, 0x42, 0x00, 0x00, 0x28, 0x41]).buffer],
            // },
            // {
            //     vr: 'OV',
            //     _rawValue: [new Uint8Array([0x00, 0x00, 0x30, 0xC0, 0x00, 0x00, 0x28, 0x41]).buffer],
            // },
            {
                vr: 'OW',
                _rawValue: [new Uint8Array([0x13, 0x40, 0x80, 0x88, 0x89, 0x91, 0x89, 0x89]).buffer],
                Value: [new Uint8Array([0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88]).buffer],
            },
            {
                vr: 'PN',
                _rawValue: ["Doe^John^A^Jr.^MD  "], // trailing spaces allowed
                Value: [{"Alphabetic": "Doe^Jane^A^Jr.^MD"}],
                newRawValue: ["Doe^Jane^A^Jr.^MD"]
            },
            {
                vr: 'SH',
                _rawValue: [" CT_SCAN_01 "], // leading/trailing spaces allowed
                Value: ["MR_SCAN_91"],
            },
            {
                vr: 'SL',
                _rawValue: [-2147483648],
                Value: [-2147481234],
            },
            {
                vr: 'SS',
                _rawValue: [-32768, 1234, 832],
                Value: [1234],
            },
            {
                vr: 'ST',
                _rawValue: ["Patient complains of headaches over the last week.    "], // trailing spaces allowed
                Value: ["Patient complains of headaches"],
            },
            // TODO: VR currently unimplemented
            // {
            //     vr: 'SV',
            //     _rawValue: [9007199254740993], // trailing spaces allowed
            // },
            {
                vr: 'TM',
                _rawValue: ["42530.123456  "], // trailing spaces allowed
                Value: ["42530"],
                newRawValue: ["42530 "]
            },
            {
                vr: 'UC',
                _rawValue: ["Detailed description of procedure or clinical notes that could be very long.  "], // trailing spaces allowed
                Value: ["Detailed description of procedure and other things"],
            },
            {
                vr: 'UI',
                _rawValue: ["1.2.840.10008.1.2.1"],
                Value: ["1.2.840.10008.1.2.2"],
            },
            {
                vr: 'UL',
                _rawValue: [4294967295],
                Value: [1],
            },
            {
                vr: 'UR',
                _rawValue: ["http://dicom.nema.org "], // trailing spaces ignored but allowed
                Value: ["https://github.com/dcmjs-org"],
            },
            {
                vr: 'US',
                _rawValue: [65535],
                Value: [1],
            },
            {
                vr: 'UT',
                _rawValue: ["    This is a detailed explanation that can span multiple lines and paragraphs in the DICOM dataset.  "], // leading spaces significant, trailing spaces allowed
                Value: [""],
            },
            // TODO: VR currently unimplemented
            // {
            //     vr: 'UV',
            //     _rawValue: [18446744073709551616], // 2^64
            // },
        ];

        test.each(changedTestCases)(
            `Test changed value overwrites original value following read and write - $vr`,
            (dataElement) => {
                const dataset = {
                    '00181041': {
                        ...dataElement
                    },
                };

                const dicomDict = new DicomDict({});
                dicomDict.dict = dataset;

                // write and re-read
                const outputDicomDict = DicomMessage.readFile(dicomDict.write(), {forceStoreRaw: true});

                // expect raw value to be updated to match new Value parsed as Number to lose precision
                expect(outputDicomDict.dict['00181041']._rawValue).toEqual(dataElement.newRawValue ?? dataElement.Value)
                expect(outputDicomDict.dict['00181041'].Value).toEqual(dataElement.Value)
            }
        )

    });

    describe('sequences', () => {
        test('nested sequences should support lossless round trip', () => {
            const dataset = {
                "52009229": {
                    vr: "SQ",
                    Value: [
                        {
                            "0020000E": {
                                vr: "UI",
                                Value: ["1.3.6.1.4.1.5962.99.1.2280943358.716200484.1363785608958.1.1"]
                            },
                            "00089123": {
                                vr: "SQ",
                                Value: [
                                    {
                                        "00181030": {
                                            vr: "AE",
                                            _rawValue: ["  TEST_AE "],
                                            Value: ["TEST_AE"],
                                        },
                                        "00180050": {
                                            vr: "DS",
                                            Value: [5.0],
                                           _rawValue: ["5.000 "]
                                        }
                                    },
                                    {
                                        "00181030": {
                                            vr: "AE",
                                            _rawValue: ["  TEST_AE "],
                                            Value: ["TEST_AE"],
                                        },
                                        "00180050": {
                                            vr: "DS",
                                            Value: [6.0],
                                           _rawValue: ["6.000 "]
                                        }
                                    }
                                ]
                            }
                        },
                        {
                            "0020000E": {
                                vr: "UI",
                                Value: ["1.3.6.1.4.1.5962.99.1.2280943358.716200484.1363785608958.1.2"]
                            },
                            "00089123": {
                                vr: "SQ",
                                Value: [
                                    {
                                        "00181030": {
                                            vr: "LO",
                                            Value: ["ABDOMEN MRI"]
                                        },
                                        "00180050": {
                                            vr: 'IS',
                                            _rawValue: [" -123   "], // leading/trailing spaces & sign allowed
                                            Value: [-123],
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            };
            
            const dicomDict = new DicomDict({});
            dicomDict.dict = dataset;

            // confirm after write raw values are re-encoded
            const outputBuffer = dicomDict.write();
            const outputDicomDict = DicomMessage.readFile(outputBuffer);

            // lossless read/write should match entire data set
            deepEqual(dicomDict.dict, outputDicomDict.dict)
        })
    })

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
