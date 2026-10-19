// packages/core/test/copyAttributesByLevel.test.js
//
// The hierarchical attribute-copy helper and its level Sets. Names and
// coverage mirror cornerstone3D's copyStudyTags.ts so the two codebases
// share one vocabulary.

import {
    patientTags,
    studyTags,
    seriesTags,
    patientStudyTags,
    copyAttributesByLevel
} from "../src/index.js";

const source = {
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.4",
    SOPInstanceUID: "1.2.3.4.5.6.7.100",
    StudyInstanceUID: "1.2.3.4.5",
    SeriesInstanceUID: "1.2.3.4.5.9",
    Modality: "MR",
    PatientName: "Doe^Jane",
    PatientID: "MRN-42",
    PatientBirthDate: "19700101",
    PatientSex: "F",
    StudyDate: "20260101",
    StudyID: "ST-7",
    AccessionNumber: "ACC-9",
    SeriesDescription: "AX T1",
    SeriesNumber: 3
};

describe("level Sets", () => {
    it("are Set instances", () => {
        expect(patientTags).toBeInstanceOf(Set);
        expect(studyTags).toBeInstanceOf(Set);
        expect(seriesTags).toBeInstanceOf(Set);
        expect(patientStudyTags).toBeInstanceOf(Set);
    });

    it("carry the cornerstone coverage", () => {
        expect(patientTags.has("PatientName")).toBe(true);
        expect(patientTags.has("IssuerOfPatientID")).toBe(true);
        expect(patientTags.has("DeidentificationMethodCodeSequence")).toBe(
            true
        );
        expect(studyTags.has("StudyInstanceUID")).toBe(true);
        expect(studyTags.has("TimezoneOffsetFromUTC")).toBe(true);
        expect(seriesTags.has("SeriesInstanceUID")).toBe(true);
        expect(seriesTags.has("Modality")).toBe(true);
    });

    it("patientStudyTags is the union of patient and study", () => {
        for (const key of patientTags) {
            expect(patientStudyTags.has(key)).toBe(true);
        }
        for (const key of studyTags) {
            expect(patientStudyTags.has(key)).toBe(true);
        }
        expect(patientStudyTags.size).toBe(patientTags.size + studyTags.size);
    });
});

describe("copyAttributesByLevel", () => {
    it("copies only patient attributes at 'patient'", () => {
        const out = copyAttributesByLevel(source, "patient");
        expect(out.PatientName).toBe("Doe^Jane");
        expect(out.PatientID).toBe("MRN-42");
        expect(out.StudyInstanceUID).toBeUndefined();
        expect(out.SeriesDescription).toBeUndefined();
    });

    it("adds study attributes at 'study' (the default)", () => {
        const out = copyAttributesByLevel(source);
        expect(out.PatientName).toBe("Doe^Jane");
        expect(out.StudyInstanceUID).toBe("1.2.3.4.5");
        expect(out.StudyID).toBe("ST-7");
        // Series level not reached.
        expect(out.SeriesInstanceUID).toBeUndefined();
        expect(out.SeriesDescription).toBeUndefined();
    });

    it("adds series attributes at 'series'", () => {
        const out = copyAttributesByLevel(source, "series");
        expect(out.PatientName).toBe("Doe^Jane"); // patient flows down
        expect(out.StudyInstanceUID).toBe("1.2.3.4.5"); // study flows down
        expect(out.SeriesInstanceUID).toBe("1.2.3.4.5.9");
        expect(out.SeriesDescription).toBe("AX T1");
        expect(out.Modality).toBe("MR");
    });

    it("adds nothing beyond series at 'instance'", () => {
        const series = copyAttributesByLevel(source, "series");
        const instance = copyAttributesByLevel(source, "instance");
        expect(instance).toEqual(series);
        // Instance identity is never inherited.
        expect(instance.SOPInstanceUID).toBeUndefined();
    });

    it("skips absent and empty attributes", () => {
        const out = copyAttributesByLevel(
            { ...source, StudyID: "", PatientSex: undefined },
            "study"
        );
        expect(out.StudyID).toBeUndefined();
        expect(out.PatientSex).toBeUndefined();
        expect(out.PatientName).toBe("Doe^Jane");
    });

    it("reads the first element of an array", () => {
        const out = copyAttributesByLevel([source, { PatientID: "OTHER" }]);
        expect(out.PatientID).toBe("MRN-42");
    });

    it("returns {} for null/undefined", () => {
        expect(copyAttributesByLevel(undefined)).toEqual({});
        expect(copyAttributesByLevel(null)).toEqual({});
    });

    it("throws on a non-object source", () => {
        expect(() => copyAttributesByLevel("nope")).toThrow(/sourceInstance/);
    });

    it("throws on an unknown dataLevel", () => {
        expect(() => copyAttributesByLevel(source, "galaxy")).toThrow(
            /dataLevel/
        );
    });

    it("does not copy _meta or _vrMap", () => {
        const out = copyAttributesByLevel(
            { ...source, _meta: { x: 1 }, _vrMap: { y: 2 } },
            "series"
        );
        expect(out._meta).toBeUndefined();
        expect(out._vrMap).toBeUndefined();
    });
});
