/**
 * Upstream issue: https://github.com/dcmjs-org/dcmjs/issues/487
 *
 * Symptom: CodeString.writeBytes validates each backslash-separated
 * component against the CS 16-char limit, so a private tag declared CS
 * whose components exceed 16 chars (GE private (07A5,1042) with values like
 * "GE_TAG_TRIGGER_TIME") made DicomDict.write() throw "Value exceeds max
 * length, vr: CS" even though the data came verbatim from the source file —
 * there was no escape hatch to copy it through.
 *
 * Triage category: A (synthetic reproducer). Contract exercised here:
 * reads are lenient; the default write throws an error that NAMES the
 * offending value; `{ allowInvalidVRLength: true }` writes it as-is.
 */
import dcmjs from "../../src/index.js";
import { validationLog } from "../../src/log.js";

validationLog.setLevel(5);

const { DicomDict, DicomMessage } = dcmjs.data;

const ELE = "1.2.840.10008.1.2.1";

function makeDict() {
    return new DicomDict({ "00020010": { vr: "UI", Value: [ELE] } });
}

describe("issue #487 — multivalued CS with over-length components", () => {
    const longComponents = [
        "GE_TAG_TRIGGER_TIME", // 19 chars
        "GE_TAG_MID_SCAN_TIME",
        "GE_TAG_ATTRIBUTE_MODIFICATION_DATETIME",
        "GE_TAG",
        "GE_TAG_ACQ"
    ];

    it("multivalued CS with every component ≤16 chars writes fine by default", () => {
        const d = makeDict();
        d.upsertTag("00080008", "CS", ["ORIGINAL", "PRIMARY", "AXIAL"]);

        let buffer;
        expect(() => {
            buffer = d.write();
        }).not.toThrow();

        const out = DicomMessage.readFile(buffer);
        expect(out.dict["00080008"].Value).toEqual([
            "ORIGINAL",
            "PRIMARY",
            "AXIAL"
        ]);
    });

    it("default strict write throws a message naming the offending value", () => {
        const d = makeDict();
        d.upsertTag("07A51042", "CS", [...longComponents]);

        expect(() => d.write()).toThrow(/GE_TAG_TRIGGER_TIME/);
        expect(() => d.write()).toThrow(/max length/);
    });

    it("writes under { allowInvalidVRLength: true } and reads back leniently", () => {
        const d = makeDict();
        d.upsertTag("07A51042", "CS", [...longComponents]);

        let buffer;
        expect(() => {
            buffer = d.write({ allowInvalidVRLength: true });
        }).not.toThrow();

        // lenient read: no length validation on the way in
        const out = DicomMessage.readFile(buffer);
        expect(out.dict["07A51042"].vr).toBe("CS");
        expect(out.dict["07A51042"].Value).toEqual(longComponents);
    });
});
