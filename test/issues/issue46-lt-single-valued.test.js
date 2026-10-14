/**
 * Upstream issue: https://github.com/dcmjs-org/dcmjs/issues/46
 *
 * Symptom: LT (Long Text) is a single-valued VR per PS3.5 6.2 — backslash
 * (5CH) is ordinary text inside it, not a value delimiter. Early dcmjs left
 * LT out of its singleVRs list, so LT text containing a backslash was split
 * into a bogus multi-valued element on read (and re-joined/garbled on
 * write).
 *
 * Triage category: A (synthetic reproducer).
 */
import dcmjs from "../../src/index.js";

const { DicomDict, DicomMessage } = dcmjs.data;

const ELE = "1.2.840.10008.1.2.1";

describe("issue #46 — LT is single-valued: backslash round-trips inside ONE value", () => {
    const historyText = "s/p CABG\\no known allergies\\follow-up in 6 months";

    function roundTrip(tag, text) {
        const d = new DicomDict({ "00020010": { vr: "UI", Value: [ELE] } });
        d.upsertTag(tag, "LT", [text]);
        return DicomMessage.readFile(d.write()).dict[tag];
    }

    it("AdditionalPatientHistory (0010,21B0) keeps backslash text as one value", () => {
        const element = roundTrip("001021B0", historyText);

        expect(element.vr).toBe("LT");
        expect(element.Value).toHaveLength(1);
        expect(element.Value[0]).toBe(historyText);
    });

    it("ImageComments (0020,4000) keeps backslash text as one value", () => {
        const comments = "ROI drawn at C:\\data\\case1\\slice12";
        const element = roundTrip("00204000", comments);

        expect(element.Value).toHaveLength(1);
        expect(element.Value[0]).toBe(comments);
        // the raw (unformatted) value is equally unsplit
        expect(element._rawValue).toHaveLength(1);
        expect(element._rawValue[0]).toContain("\\");
    });
});
