/**
 * Issue-derived regression tests — anonymizer public surface + tag names.
 *
 * #172 (C — contract): https://github.com/dcmjs-org/dcmjs/issues/172
 *   Upstream ask: expose cleanTags from the anonymizer.
 *   1.0 delta: cleanTags AND getTagsNameToEmpty are exported both as the
 *   dcmjs.anonymizer namespace and as named exports of src/index.js;
 *   cleanTags operates on the (denaturalized) DicomDict.dict, replacing
 *   PatientName/PatientID and emptying the remainder of the list.
 *
 * #345 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/345
 *   Symptom: many strings in tagNamesToEmpty (src/anonymizer.js) are not
 *   real dictionary keywords (singular/plural mistakes and ad-hoc
 *   abbreviations like "RefStudySeq"), so cleanTags silently skips those
 *   tags — the data they were meant to scrub is left in place. The issue
 *   names five suspects: ReferringPhysicianTelephoneNumbers (list has
 *   ReferringPhysicianPhoneNumbers), PhysiciansOfRecord (has
 *   PhysicianOfRecord), NameOfPhysiciansReadingStudy (has
 *   NameOfPhysicianReadingStudy), OperatorsName (has OperatorName),
 *   AdmittingDiagnosesDescription (has AdmittingDiagnosisDescription).
 *   Observed: 103 of the 221 names fail to resolve via
 *   DicomMetaDictionary.nameMap — pinned below as a KNOWN GAP.
 *
 * Related existing coverage: test/anonymizer.test.js exercises cleanTags
 * behavior on fixtures; it does not validate the name list itself.
 */
import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

describe("issue #172 — anonymizer public surface", () => {
    it("exports cleanTags and getTagsNameToEmpty on dcmjs.anonymizer", () => {
        expect(typeof dcmjs.anonymizer.cleanTags).toBe("function");
        expect(typeof dcmjs.anonymizer.getTagsNameToEmpty).toBe("function");
        const names = dcmjs.anonymizer.getTagsNameToEmpty();
        expect(Array.isArray(names)).toBe(true);
        expect(names.length).toBeGreaterThan(100);
        // Returns a copy, not the internal array
        names.push("NotARealTag");
        expect(dcmjs.anonymizer.getTagsNameToEmpty()).not.toContain(
            "NotARealTag"
        );
    });

    it("cleanTags replaces PatientName and empties listed elements on a read dict", () => {
        const buffer = createSampleDicom({
            dict: {
                "00100010": { vr: "PN", Value: [{ Alphabetic: "DOE^JANE" }] },
                "00100020": { vr: "LO", Value: ["ID-12345"] },
                "00101010": { vr: "AS", Value: ["030Y"] }
            }
        });
        const dicomDict = DicomMessage.readFile(buffer);
        dcmjs.anonymizer.cleanTags(dicomDict.dict);

        // Default replacement map for PatientName / PatientID
        expect(dicomDict.dict["00100010"].Value).toEqual(["ANON^PATIENT"]);
        expect(dicomDict.dict["00100020"].Value).toEqual(["ANON^ID"]);
        // PatientAge is on the to-empty list and resolves — emptied
        expect(dicomDict.dict["00101010"].Value).toEqual([]);

        // The cleaned dict still writes and re-reads
        const reread = DicomMessage.readFile(dicomDict.write());
        expect(reread.dict["00100010"].Value[0].Alphabetic).toBe(
            "ANON^PATIENT"
        );
    });
});

describe("issue #345 — every anonymizer tag name must be a real dictionary keyword", () => {
    it("the five keywords the issue says SHOULD be used do resolve in the dictionary", () => {
        // Sanity: the corrected names exist as real keywords, so fixing
        // the list is possible without dictionary changes.
        const correct = [
            "ReferringPhysicianTelephoneNumbers",
            "PhysiciansOfRecord",
            "NameOfPhysiciansReadingStudy",
            "OperatorsName",
            "AdmittingDiagnosesDescription"
        ];
        const unresolved = correct.filter(
            name => !DicomMetaDictionary.nameMap[name]
        );
        expect(unresolved).toEqual([]);
    });

    // KNOWN GAP: observed — 103 of the 221 entries returned by
    // getTagsNameToEmpty() do not resolve via
    // DicomMetaDictionary.nameMap, so cleanTags silently skips them and
    // the corresponding PHI survives anonymization. The set includes the
    // issue's five suspects (ReferringPhysicianPhoneNumbers,
    // PhysicianOfRecord, NameOfPhysicianReadingStudy, OperatorName,
    // AdmittingDiagnosisDescription) plus ~98 more ad-hoc names such as
    // RefStudySeq, ContrastAllergies, SPSStartDate, PPSComments, ....
    // Expected: every name resolves to a real dictionary keyword.
    it.skip("KNOWN GAP #345: getTagsNameToEmpty contains names that resolve to no dictionary keyword", () => {
        const names = dcmjs.anonymizer.getTagsNameToEmpty();
        const nonResolving = names.filter(
            name => !DicomMetaDictionary.nameMap[name]
        );
        // The failing diff lists every non-resolving name.
        expect(nonResolving).toEqual([]);
    });
});
