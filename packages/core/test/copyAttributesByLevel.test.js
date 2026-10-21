// packages/core/test/copyAttributesByLevel.test.js
//
// The level hierarchy and the attribute copy. These own the inheritance
// rules; the builders that use them do not repeat these cases.

import {
    copyAttributesByLevel,
    deepCloneInstance,
    extendDataLevels,
    DATA_LEVELS
} from "../src/index.js";

const source = {
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.4",
    SOPInstanceUID: "1.2.3.4.5.6.7.100",
    StudyInstanceUID: "1.2.3.4.5",
    SeriesInstanceUID: "1.2.3.4.5.9",
    Modality: "MR",
    PatientName: "Doe^Jane",
    PatientID: "MRN-42",
    PatientAge: "056Y",
    StudyID: "ST-7",
    SeriesDescription: "AX T1",
    SeriesNumber: 3,
    OtherPatientIDsSequence: [{ PatientID: "ALT-1" }],
    _meta: { x: 1 },
    _vrMap: { y: "OB" }
};

describe("copyAttributesByLevel", () => {
    it("copies only patient attributes at 'patient'", () => {
        const out = copyAttributesByLevel(source, "patient");
        expect(out.PatientName).toBe("Doe^Jane");
        expect(out.StudyInstanceUID).toBeUndefined();
        expect(out.PatientAge).toBeUndefined();
    });

    it("adds study attributes at 'study' (the default), PatientAge included", () => {
        const out = copyAttributesByLevel(source);
        expect(out.PatientName).toBe("Doe^Jane");
        expect(out.StudyInstanceUID).toBe("1.2.3.4.5");
        expect(out.PatientAge).toBe("056Y");
        expect(out.SeriesInstanceUID).toBeUndefined();
    });

    it("adds series attributes at 'series', series identity included", () => {
        const out = copyAttributesByLevel(source, "series");
        expect(out.StudyInstanceUID).toBe("1.2.3.4.5");
        expect(out.SeriesInstanceUID).toBe("1.2.3.4.5.9");
        expect(out.Modality).toBe("MR");
        expect(out.SOPInstanceUID).toBeUndefined();
        expect(out._meta).toBeUndefined();
        expect(out._vrMap).toBeUndefined();
    });

    it("skips absent and empty values", () => {
        const out = copyAttributesByLevel(
            { ...source, StudyID: "", PatientID: undefined },
            "study"
        );
        expect(out).not.toHaveProperty("StudyID");
        expect(out).not.toHaveProperty("PatientID");
    });

    it("reads the first element of an array", () => {
        const out = copyAttributesByLevel([source, { PatientID: "OTHER" }]);
        expect(out.PatientID).toBe("MRN-42");
    });

    it("throws on an unknown dataLevel", () => {
        expect(() => copyAttributesByLevel(source, "galaxy")).toThrow(
            /dataLevel/
        );
    });

    it("shares object values, and deepCloneInstance of the source makes them independent", () => {
        const shared = copyAttributesByLevel(source, "patient");
        expect(shared.OtherPatientIDsSequence).toBe(
            source.OtherPatientIDsSequence
        );
        const cloned = copyAttributesByLevel(
            deepCloneInstance(source),
            "patient"
        );
        expect(cloned.OtherPatientIDsSequence).toEqual(
            source.OtherPatientIDsSequence
        );
        expect(cloned.OtherPatientIDsSequence).not.toBe(
            source.OtherPatientIDsSequence
        );
    });

    it("uses a custom level list: extended patient level and a new level", () => {
        const levels = [
            ...extendDataLevels(DATA_LEVELS, {
                patient: ["PatientComments"]
            }).slice(0, 2),
            { name: "frameOfReference", tags: new Set(["FrameOfReferenceUID"]) }
        ];
        const out = copyAttributesByLevel(
            {
                ...source,
                PatientComments: "note",
                FrameOfReferenceUID: "1.9"
            },
            "frameOfReference",
            { levels }
        );
        expect(out.PatientComments).toBe("note");
        expect(out.StudyInstanceUID).toBe("1.2.3.4.5");
        expect(out.FrameOfReferenceUID).toBe("1.9");
        expect(out.SeriesInstanceUID).toBeUndefined();
        // The shared default is unchanged.
        expect(DATA_LEVELS[0].tags.has("PatientComments")).toBe(false);
    });
});
