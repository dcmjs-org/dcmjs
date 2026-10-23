import { types } from "util";
import { DicomMetaDictionary, addAccessors } from "@dcmjs-org/core";

const dict = {
    "00100010": { vr: "PN", Value: [{ Alphabetic: "Doe^Jane" }] },
    "00080008": { vr: "CS", Value: ["ORIGINAL"] }, // VM 2-n, one value
    "00100020": { vr: "LO", Value: ["12345"] }, // VM 1
    "00101000": { vr: "LO", Value: [] }, // VM 1-n, present and empty
    "00081110": {
        vr: "SQ",
        Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
    }
};

describe("core naturalizeDataset (1.0 rules)", () => {
    test("VM decides between a single value and a list", () => {
        const ds = DicomMetaDictionary.naturalizeDataset(dict);
        expect(ds.ImageType).toEqual(["ORIGINAL"]);
        expect(ds.PatientID).toBe("12345");
        expect(ds.OtherPatientIDs).toEqual([]);
        expect(String(ds.PatientName)).toBe("Doe^Jane");
        expect(types.isProxy(ds)).toBe(false);
    });

    test("a single-item sequence is the item, with [0], length and iteration", () => {
        const seq =
            DicomMetaDictionary.naturalizeDataset(dict).ReferencedStudySequence;
        expect(types.isProxy(seq)).toBe(false);
        expect(Array.isArray(seq)).toBe(false);
        expect(seq.ReferencedSOPClassUID).toBe("1.2.3");
        expect(seq[0]).toBe(seq);
        expect(seq.length).toBe(1);
        expect([...seq]).toEqual([seq]);
        expect(JSON.parse(JSON.stringify(seq))).toEqual({
            _vrMap: {},
            ReferencedSOPClassUID: "1.2.3"
        });
    });

    test("the naturalized dataset denaturalizes to the source dict", () => {
        const ds = DicomMetaDictionary.naturalizeDataset(dict);
        const back = DicomMetaDictionary.denaturalizeDataset(ds);
        expect(back["00081110"].Value[0]["00081150"].Value).toEqual(["1.2.3"]);
        expect(back["00080008"].Value).toEqual(["ORIGINAL"]);
        expect(JSON.parse(JSON.stringify(back["00100010"].Value))).toEqual([
            { Alphabetic: "Doe^Jane" }
        ]);
    });

    test("addAccessors leaves a list that does not hold exactly one item", () => {
        const two = [{ a: 1 }, { a: 2 }];
        expect(addAccessors(two)).toBe(two);
    });
    test("an empty DS value (Value [null]) survives denaturalize", () => {
        // a reader gives an empty DS of VM 1-n as Value: [null]
        const ds = DicomMetaDictionary.naturalizeDataset({
            "00282112": { vr: "DS", Value: [null] },
            "00181310": { vr: "US", Value: [0, 256, 256, 0] }
        });
        expect(ds.LossyImageCompressionRatio).toEqual([null]);
        const back = DicomMetaDictionary.denaturalizeDataset(ds);
        expect(back["00282112"]).toEqual({ vr: "DS", Value: [null] });
        expect(back["00181310"].Value).toEqual(["0", "256", "256", "0"]);
    });
});
