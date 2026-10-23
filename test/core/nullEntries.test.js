/**
 * A null entry in a value list is an empty value, as in DICOM JSON
 * (docs/specs/naturalized-dataset.md, NAT-U-RT-7): it is written as empty
 * text, as an empty PN name, or, for a binary number, as 0 with a warning.
 */
import dcmjs from "../../src/index.js";
import { fromNaturalized } from "../../src/eventStream/fromNaturalized";
import { Part10Writer } from "../../src/eventStream/Part10Writer";

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;

const sourceDict = () => ({
    "00101000": { vr: "LO", Value: [null, "A"] }, // OtherPatientIDs
    "00101001": {
        vr: "PN",
        Value: [null, { Alphabetic: "C^D" }] // OtherPatientNames
    },
    "00282112": { vr: "DS", Value: [null] }, // LossyImageCompressionRatio
    "00181310": { vr: "US", Value: [null, 3] } // AcquisitionMatrix
});

function writeBytes(dict) {
    const dicomDict = new DicomDict({
        "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] }
    });
    dicomDict.dict = dict;
    return dicomDict.write();
}

function writeDict(dict) {
    return DicomMessage.readFile(writeBytes(dict)).dict;
}

// The 16-bit value length of an explicit-VR element with a short header.
function elementLength(buffer, tagBytes) {
    const bytes = new Uint8Array(buffer);
    for (let i = 132; i <= bytes.length - 8; i++) {
        if (tagBytes.every((b, k) => bytes[i + k] === b)) {
            return bytes[i + 6] | (bytes[i + 7] << 8);
        }
    }
    return undefined;
}

describe("null entries in a value list", () => {
    it("are written as empty values on every write path", async () => {
        const warn = jest.spyOn(dcmjs.log, "warn").mockImplementation(() => {});
        const naturalized = DicomMetaDictionary.naturalizeDataset(sourceDict());
        expect(naturalized.OtherPatientNames).toHaveLength(2);

        const writer = new Part10Writer();
        await fromNaturalized(naturalized, writer);
        for (const back of [
            writeDict(sourceDict()), // DICOM JSON, written directly
            writeDict(DicomMetaDictionary.denaturalizeDataset(naturalized)),
            DicomMessage.readFile(writer.write()).dict
        ]) {
            expect(back["00101000"].Value).toEqual(["", "A"]);
            // the empty name keeps its position in the written text; the
            // reader's PN string parse then drops empty names
            expect(back["00101001"]._rawValue).toBe("\\C^D");
            expect(back["00282112"].Value).toEqual([null]);
            expect(back["00181310"].Value).toEqual([0, 3]);
        }
        expect(warn.mock.calls.flat().join(" ")).toMatch(
            /US value 0 is empty \(null\); it is written as 0/
        );
        warn.mockRestore();
    });

    it("an element with no value is written with zero length and no warning", () => {
        // DICOMweb metadata gives an empty Type 2 element with no Value
        const warn = jest.spyOn(dcmjs.log, "warn").mockImplementation(() => {});
        const source = () => ({ "00280011": { vr: "US" } }); // Columns
        const naturalized = DicomMetaDictionary.naturalizeDataset(source());
        expect(naturalized.Columns).toBeNull();
        for (const dict of [
            source(),
            DicomMetaDictionary.denaturalizeDataset(naturalized)
        ]) {
            // explicit VR little endian: tag (0028,0011), "US", length 0
            // (the reader gives a zero-length US as its default value, 0)
            expect(elementLength(writeBytes(dict), [0x28, 0, 0x11, 0])).toBe(0);
        }
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it("a null entry of a UV list is written as 0 with a warning", () => {
        const warn = jest.spyOn(dcmjs.log, "warn").mockImplementation(() => {});
        const back = writeDict({
            "00720028": { vr: "UV", Value: [null, 5] } // SelectorUVValue
        });
        expect(back["00720028"].Value.map(Number)).toEqual([0, 5]);
        expect(warn.mock.calls.flat().join(" ")).toMatch(
            /UV value 0 is empty \(null\); it is written as 0/
        );
        warn.mockRestore();
    });
});
