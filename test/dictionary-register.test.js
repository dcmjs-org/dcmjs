/**
 * registerTag() behaviour that 0.53.3 (#625, #510) has and 1.0 must keep.
 * Each test uses its own group, because the registry is global.
 */
import dcmjs from "../src/index.js";

const { DicomMetaDictionary, registerTag, dictionary } = dcmjs.data;

describe("registerTag", () => {
    it("is exported on dcmjs.data with the dictionary", () => {
        expect(typeof registerTag).toBe("function");
        expect(dictionary["(0010,0010)"].name).toBe("PatientName");
    });

    it("keeps the keyword of a tag registered in lower case when a file is read", () => {
        registerTag("(4d46,1001)", {
            name: "TestLowerRegistered",
            vr: "LO",
            vm: "1"
        });
        // a reader makes upper case keys
        const dataset = DicomMetaDictionary.naturalizeDataset({
            "4D461001": { vr: "LO", Value: ["value"] }
        });
        expect(dataset.TestLowerRegistered).toBe("value");
        const dict = DicomMetaDictionary.denaturalizeDataset(dataset);
        expect(dict["4D461001"].Value).toEqual(["value"]);
    });

    it("finds the entry with either case", () => {
        registerTag("4d451002", { name: "TestBothCases", vr: "CS" });
        expect(dictionary["(4D45,1002)"].name).toBe("TestBothCases");
        expect(dictionary["4d451002"].name).toBe("TestBothCases");
        expect(DicomMetaDictionary.tagAsIntegerFromName("TestBothCases")).toBe(
            0x4d451002
        );
    });

    it("keeps the first registration of a name; the second tag reads by its hex tag", () => {
        const warn = jest.spyOn(dcmjs.log, "warn");
        registerTag("(4D52,1001)", { name: "TestFirstName", vr: "LO" });
        registerTag("(4D52,1002)", { name: "TestFirstName", vr: "LO" });
        expect(warn).toHaveBeenCalledWith(
            expect.stringMatching(/\(4D52,1001\).*\(4D52,1002\)/)
        );
        warn.mockRestore();
        const dataset = DicomMetaDictionary.naturalizeDataset({
            "4D521001": { vr: "LO", Value: ["first"] },
            "4D521002": { vr: "LO", Value: ["second"] }
        });
        const dict = DicomMetaDictionary.denaturalizeDataset(dataset);
        expect(dict["4D521001"].Value).toEqual(["first"]);
        expect(dict["4D521002"].Value).toEqual(["second"]);
    });

    it("applies the tag and keyword rules", () => {
        // a name of a standard keyword: the same tag is accepted, a different tag throws
        registerTag("(0010,0020)", { name: "PatientID", vr: "LO" });
        expect(() =>
            registerTag("(4D65,1001)", { name: "PatientID", vr: "LO" })
        ).toThrow(/PatientID/);
        // the first argument wins over entry.tag
        registerTag("(4D61,1001)", {
            ...dictionary["(0010,0010)"],
            name: "TestCopied"
        });
        expect(DicomMetaDictionary.entryForName("TestCopied").tag).toBe(
            "(4D61,1001)"
        );
        // a new name for a registered tag replaces the old name
        registerTag("(4D63,1001)", { name: "TestOldName", vr: "LO" });
        registerTag("(4D63,1001)", { name: "TestNewName", vr: "LO" });
        expect(DicomMetaDictionary.entryForName("TestOldName")).toBeUndefined();
        expect(DicomMetaDictionary.entryForName("constructor")).toBeUndefined();
    });
});

describe("cleanTags", () => {
    it("empties a registered name in a custom list, and ResponsiblePersonRole by default", () => {
        registerTag("(4D54,1001)", { name: "TestAnonName", vr: "LO" });
        const dict = {
            "4D541001": { vr: "LO", Value: ["PHI"] },
            "00102298": { vr: "CS", Value: ["MOTHER"] }
        };
        dcmjs.anonymizer.cleanTags(dict, undefined, ["TestAnonName"]);
        expect(dict["4D541001"].Value).toEqual([]);
        dcmjs.anonymizer.cleanTags(dict);
        expect(dict["00102298"].Value).toEqual([]);
    });
});
