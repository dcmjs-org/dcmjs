import fs from "fs";
import crypto from "crypto";
import dcmjs from "../src/index.js";
import { deepEqual } from "../src/utilities/deepEqual";
import {
    DEFLATED_EXPLICIT_LITTLE_ENDIAN,
    UNDEFINED_LENGTH,
    TagHex
} from "../src/constants/dicom.js";

import { getTestDataset } from "./testUtils";
import { DicomMetaDictionary } from "../src/DicomMetaDictionary";
import { ValueRepresentation } from "../src/ValueRepresentation";
import { BufferStream, WriteBufferStream } from "../src/BufferStream";

const { DicomDict, DicomMessage } = dcmjs.data;

describe("vr basic behavior", () => {
    describe("storeRaw option", () => {
        const binaryVR = new Set(["OB"]);
        const binaryBuffer = new Uint8Array([5,6,7,54,3,255,6,4,63,23]);
        const dataset = {
            "00080008": {
                vr: "CS",
                Value: ["DERIVED"]
            },
            "00082112": {
                vr: "SQ",
                Value: [
                    {
                        "00081150": {
                            vr: "UI",
                            Value: ["1.2.840.10008.5.1.4.1.1.7"]
                        }
                    }
                ]
            },
            "00180050": {
                vr: "DS",
                Value: [1]
            },
            "00181708": {
                vr: "IS",
                Value: [426]
            },
            "00189328": {
                vr: "FD",
                Value: [30.98]
            },
            "0020000D": {
                vr: "UI",
                Value: [
                    "1.3.6.1.4.1.5962.99.1.2280943358.716200484.1363785608958.3.0"
                ]
            },
            "00400254": {
                vr: "LO",
                Value: ["DUCTO/GALACTOGRAM 1 DUCT LT"]
            },
            "7FE00010": {
                vr: "OW",
                Value: [new Uint8Array([0x00, 0x00]).buffer]
            }
        };

        const rawDataset = {
            "00080008": {
                vr: "CS",
                Value: ["DERIVED"],
                _rawValue: ["DERIVED"]
            },
            "00082112": {
                vr: "SQ",
                Value: [
                    {
                        "00081150": {
                            vr: "UI",
                            Value: ["1.2.840.10008.5.1.4.1.1.7"],
                            _rawValue: ["1.2.840.10008.5.1.4.1.1.7"]
                        }
                    }
                ],
                _rawValue: [
                    {
                        "00081150": {
                            vr: "UI",
                            Value: ["1.2.840.10008.5.1.4.1.1.7"],
                            _rawValue: ["1.2.840.10008.5.1.4.1.1.7"]
                        }
                    }
                ]
            },
            "00180050": {
                vr: "DS",
                Value: [1],
                _rawValue: [1]
            },
            "00181708": {
                vr: "IS",
                Value: [426],
                _rawValue: [426]
            },
            "00189328": {
                vr: "FD",
                Value: [30.98],
                _rawValue: [30.98]
            },
            "0020000D": {
                vr: "UI",
                Value: [
                    "1.3.6.1.4.1.5962.99.1.2280943358.716200484.1363785608958.3.0"
                ],
                _rawValue: [
                    "1.3.6.1.4.1.5962.99.1.2280943358.716200484.1363785608958.3.0"
                ]
            },
            "00400254": {
                vr: "LO",
                Value: ["DUCTO/GALACTOGRAM 1 DUCT LT"],
                _rawValue: ["DUCTO/GALACTOGRAM 1 DUCT LT"]
            },
            "7FE00010": {
                vr: "OW",
                Value: [new Uint8Array([0x00, 0x00]).buffer],
                _rawValue: [new Uint8Array([0x00, 0x00]).buffer]
            }
        };

        const VRs = [
            {
                vr: "US",
                funcType: "Uint16",
                readFunc: "readUint16",
                expectedLength: 2,
                testValue: 5,
                expectedValue: 5,
                expectedRawValue: 5
            },
            {
                vr: "UI",
                funcType: "AsciiString",
                readFunc: "readAsciiString",
                expectedLength: 19,
                testValue: ["1.2.840.10008.1.2.1"],
                expectedRawValue: "1.2.840.10008.1.2.1",
                expectedValue: "1.2.840.10008.1.2.1"
            },
            {
                vr: "CS",
                funcType: "AsciiString",
                readFunc: "readAsciiString",
                expectedLength: 3,
                testValue: ["5", "5"],
                expectedRawValue: "5\\5",
                expectedValue: ["5", "5"]
            },
            {
                vr: "LO",
                funcType: "UTF8String",
                readFunc: "readEncodedString",
                expectedLength: 14,
                testValue: "I ♥ my wife!",
                expectedRawValue: "I ♥ my wife!",
                expectedValue: "I ♥ my wife!"
            },
            {
                vr: "SL",
                funcType: "Int32",
                readFunc: "readInt32",
                expectedLength: 4,
                testValue: -5,
                expectedRawValue: -5,
                expectedValue: -5
            },
            {
                vr: "OB",
                funcType: "Uint8Repeat",
                readFunc: "readUint8Array",
                expectedLength: 10,
                testValue: [binaryBuffer.buffer],
                expectedRawValue: binaryBuffer,
                expectedValue: binaryBuffer
            },
        ];

        test("Write DicomDict without _rawValue", async () => {
            const dicomDict = new DicomDict({});
            dicomDict.dict = dataset;

            dicomDict.write();
            // No errors here = pass.
        });

        test("Checking write method in VR", async () => {
            const fileStream = new WriteBufferStream(4096, true);
            let vr = ValueRepresentation.createByTypeString("DS");

            const result = vr.write(fileStream);
            expect(result).toEqual([0]);
        });

        test("Checking write method in VR requesting specific write type and confirmed with raw value", async () => {
            VRs.forEach(vrItem => {
                const fileStream = new BufferStream();
                let vr = ValueRepresentation.createByTypeString(vrItem.vr);
                vr._allowMultiple = Array.isArray(vrItem.testValue) && !binaryVR.has(vrItem.vr);

                let written = -1;
                if (binaryVR.has(vrItem.vr)) {
                    written = vr.writeBytes(fileStream, vrItem.testValue);
                } else {
                    written = vr.write(fileStream, vrItem.funcType, vrItem.testValue);
                }
                expect(written).toEqual(vrItem.expectedLength);


                fileStream.reset();
                // Checking at the stream level because it returns a more raw result.
                const result = fileStream[vrItem.readFunc](written);
                expect(result).toEqual(vrItem.expectedRawValue);
            });
        });

        test("Checking writeBytes method in VR requesting specific write type", async () => {
            VRs.forEach(vrItem => {
                const fileStream = new BufferStream();
                let vr = ValueRepresentation.createByTypeString(vrItem.vr);
                vr._allowMultiple = Array.isArray(vrItem.testValue) && !binaryVR.has(vrItem.vr);

                const written = vr.writeBytes(fileStream, vrItem.testValue);
                fileStream.reset();
                let result = vr.readBytes(fileStream, written);

                expect(result).toEqual(vrItem.expectedValue);
            });
        });
    });
});
