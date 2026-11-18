import { DicomMetaDictionary } from "../src/DicomMetaDictionary";
// Through the package entry point: index.js is what wires the modules to each
// other, so importing datasetToBlob.js on its own leaves DicomDict undefined.
import dcmjs from "../src/index.js";
import { EXPLICIT_LITTLE_ENDIAN } from "../src/constants/dicom.js";

const { datasetToDict, DicomMessage } = dcmjs.data;

describe("DicomMetaDictionary", () => {
    describe("static methods", () => {
        describe("denaturalizeDataset", () => {
            it("formats long DS numbers instead of cutting off the exponent", () => {
                const dataset = DicomMetaDictionary.denaturalizeDataset({
                    ImageOrientationPatient: [
                        1, 0, 0, 0, 1, 3.5163338899999997e-10
                    ]
                });
                const values = dataset["00200037"].Value;

                expect(values.every(value => value.length <= 16)).toBe(true);
                expect(Number(values[5])).toBeCloseTo(
                    3.5163338899999997e-10,
                    20
                );
            });

            // The test above checks what denaturalizeDataset returns. This one
            // checks what actually reaches the file and comes back out of it,
            // which is the property that matters to a reader: DS is a string on
            // disk, so a value that was formatted correctly can still be lost if
            // anything downstream reformats or truncates it.
            it("round trips a long DS number through a write and a read", () => {
                const sopClassUID = "1.2.840.10008.5.1.4.1.1.4";
                const buffer = datasetToDict({
                    SOPClassUID: sopClassUID,
                    SOPInstanceUID: "1.2.3",
                    ImageOrientationPatient: [
                        1, 0, 0, 0, 1, 3.5163338899999997e-10
                    ],
                    _meta: {
                        TransferSyntaxUID: {
                            Value: [EXPLICIT_LITTLE_ENDIAN],
                            vr: "UI"
                        },
                        MediaStorageSOPClassUID: {
                            Value: [sopClassUID],
                            vr: "UI"
                        },
                        MediaStorageSOPInstanceUID: {
                            Value: ["1.2.3"],
                            vr: "UI"
                        }
                    }
                }).write();

                const element = DicomMessage.readFile(buffer).dict["00200037"];

                // _rawValue is the string as it was encoded, before DS parses it
                expect(element._rawValue).toEqual([
                    "1",
                    "0",
                    "0",
                    "0",
                    "1",
                    "3.5163338900e-10"
                ]);
                expect(
                    element._rawValue.every(value => value.length <= 16)
                ).toBe(true);
                expect(
                    DicomMetaDictionary.naturalizeDataset(
                        DicomMessage.readFile(buffer).dict
                    ).ImageOrientationPatient
                ).toEqual([1, 0, 0, 0, 1, 3.51633389e-10]);
            });
        });

        describe("unpunctuateTag", () => {
            it("returns the unpunctuated tag String", () => {
                const originalTag = "(0000,0003)";
                const unpunctuatedTag = "00000003";

                expect(DicomMetaDictionary.unpunctuateTag(originalTag)).toMatch(
                    unpunctuatedTag
                );
            });
        });

        describe("parseIntFromTag", () => {
            it("returns the correct Integer of a simple Integer", () => {
                const originalTag = "(0000,0003)";
                const integerValue = 3;

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(
                    integerValue
                );
            });

            it("returns the correct Integer of a simple hexadecimal String", () => {
                const originalTag = "(0000,000F)";
                const integerValue = 15;

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(
                    integerValue
                );
            });

            it("returns the correct Integer of a complex hexadecimal String", () => {
                const originalTag = "(000F,0000)";
                const integerValue = 983040;

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(
                    integerValue
                );
            });

            it("returns NaN if String can not be parsed", () => {
                const originalTag = "()";

                expect(DicomMetaDictionary.parseIntFromTag(originalTag)).toBe(
                    NaN
                );
            });
        });

        describe("tagAsIntegerFromName", () => {
            it("returns undefined if name has no item in dictionary", () => {
                const tagName = "dummy";

                expect(DicomMetaDictionary.tagAsIntegerFromName(tagName)).toBe(
                    undefined
                );
            });

            describe("tagAsIntegerFromName", () => {
                it("returns the tag as integer value", () => {
                    const tagName = "AffectedSOPClassUID";

                    expect(
                        DicomMetaDictionary.tagAsIntegerFromName(tagName)
                    ).toBe(2);
                });
            });
        });
    });
});
