/**
 * Upstream issue: https://github.com/dcmjs-org/dcmjs/issues/531
 *   denaturalizeDataset wrote a DS number with String(number) and then cut
 *   it to 16 characters, which dropped the exponent of a value such as
 *   3.5163338899999997e-10. 1.0 port of the test of #610 and of the round
 *   trip test of #624.
 */
import dcmjs from "../../src/index.js";
import { EXPLICIT_LITTLE_ENDIAN } from "../../src/constants/dicom.js";

const { datasetToDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;

describe("denaturalizeDataset DS formatting (#531)", () => {
    it("formats long DS numbers instead of cutting off the exponent", () => {
        const dataset = DicomMetaDictionary.denaturalizeDataset({
            ImageOrientationPatient: [1, 0, 0, 0, 1, 3.5163338899999997e-10]
        });
        const values = dataset["00200037"].Value;

        expect(values.every(value => value.length <= 16)).toBe(true);
        expect(Number(values[5])).toBeCloseTo(3.5163338899999997e-10, 20);
    });

    // The test above checks what denaturalizeDataset returns. This one
    // checks what reaches the file and comes back out of it: DS is a string
    // on disk, so a value that was formatted correctly can still be lost if
    // anything downstream reformats or truncates it.
    it("round trips a long DS number through a write and a read", () => {
        const sopClassUID = "1.2.840.10008.5.1.4.1.1.4";
        const buffer = datasetToDict({
            SOPClassUID: sopClassUID,
            SOPInstanceUID: "1.2.3",
            ImageOrientationPatient: [1, 0, 0, 0, 1, 3.5163338899999997e-10],
            _meta: {
                TransferSyntaxUID: {
                    Value: [EXPLICIT_LITTLE_ENDIAN],
                    vr: "UI"
                },
                MediaStorageSOPClassUID: { Value: [sopClassUID], vr: "UI" },
                MediaStorageSOPInstanceUID: { Value: ["1.2.3"], vr: "UI" }
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
        expect(element._rawValue.every(value => value.length <= 16)).toBe(true);
        expect(
            DicomMetaDictionary.naturalizeDataset(
                DicomMessage.readFile(buffer).dict
            ).ImageOrientationPatient
        ).toEqual([1, 0, 0, 0, 1, 3.51633389e-10]);
    });
});
