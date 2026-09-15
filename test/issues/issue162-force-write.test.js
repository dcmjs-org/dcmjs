/**
 * The force-write option contract for abnormal VR lengths.
 *
 * Upstream issue (triage category C - contract assertion):
 * - #162 https://github.com/dcmjs-org/dcmjs/issues/162
 *   The DICOM Standard Browser team asked for an option to force-write
 *   files whose values violate VR length limits ("Value exceeds max
 *   length" errors blocked writing edited files).
 *
 * 1.0 contract asserted here (and the delta from the upstream report):
 * - The requested escape hatch EXISTS and kept the upstream option name:
 *   write({ allowInvalidVRLength: true }) - default false - threaded from
 *   DicomDict.write (src/DicomDict.js:28) into
 *   ValueRepresentation.writeBytes (src/ValueRepresentation.js:285-297),
 *   where a truthy value bypasses length validation entirely.
 * - Default (strict) writes still throw for over-length values on
 *   byte-length-checked VRs, with a message naming the VR and value.
 * - 1.0 delta: over-length values on maxCharLength STRING VRs (SH, LO,
 *   UC ...) no longer throw at all - they only log (see the isString
 *   branch in writeBytes); strictness applies to maxLength/checkLength
 *   VRs such as AS used below.
 *
 * Existing coverage cited (this file extends, does not duplicate):
 * - test/data.test.js "test_invalid_vr_length": fixture
 *   test/invalid-vr-length-test.dcm round trip, both option values, plus
 *   the lazy-core passthrough pin.
 * - test/writer-hardening.test.js: allowInvalidVRLength is
 *   validation-only and does not disable the (deprecated) passthrough.
 * - test/eventStream/Part10Writer.test.js: streaming writer accepts the
 *   same option.
 * Missing angle covered here: a SYNTHETIC over-length element (no fixture),
 * the error message contract (names VR + value), and value preservation
 * through the forced write's lenient re-read (#374 read-side pairing).
 *
 * validationLog is silenced (level 5): deliberately-invalid values are fed.
 */

import dcmjs from "../../src/index.js";
import { log, validationLog } from "../../src/log.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMessage } = dcmjs.data;

const EXTRA_DICT = {
    "00080018": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9"] },
    "00100010": { vr: "PN", Value: ["Doe^John"] }
};

// AS (Age String) has maxLength 4; six characters is abnormal.
const OVERLONG_AS = "099Y99";

function makeDicomDictWithOverlongAS() {
    const dicomDict = DicomMessage.readFile(
        createSampleDicom({ dict: EXTRA_DICT })
    );
    dicomDict.dict["00101010"] = { vr: "AS", Value: [OVERLONG_AS] };
    return dicomDict;
}

beforeAll(() => {
    validationLog.setLevel(5);
    // the lenient re-read logs a fixed-length mismatch via the main log;
    // jest module isolation confines this to the current test file
    log.setLevel(5);
});

describe("issue #162 - force-write option for abnormal VR lengths (1.0 contract)", () => {
    it("default write throws a corrective error naming the VR and the value", () => {
        const dicomDict = makeDicomDictWithOverlongAS();

        let error;
        try {
            dicomDict.write();
        } catch (e) {
            error = e;
        }
        expect(error).toBeDefined();
        expect(String(error.message)).toMatch(/Value exceeds max length/);
        expect(String(error.message)).toMatch(/AS/);
        expect(String(error.message)).toMatch(new RegExp(OVERLONG_AS));
    });

    it("explicit strict option behaves identically to the default", () => {
        const dicomDict = makeDicomDictWithOverlongAS();
        expect(() => dicomDict.write({ allowInvalidVRLength: false })).toThrow(
            /Value exceeds max length/
        );
    });

    it("write({allowInvalidVRLength:true}) succeeds and the abnormal value survives the round trip", () => {
        const dicomDict = makeDicomDictWithOverlongAS();

        let outBuffer;
        expect(() => {
            outBuffer = dicomDict.write({ allowInvalidVRLength: true });
        }).not.toThrow();

        // The lenient READ side (#374 pairing) accepts the abnormal
        // stored length; the value is preserved verbatim.
        const reRead = DicomMessage.readFile(outBuffer);
        expect(reRead.dict["00101010"]).toBeDefined();
        expect(reRead.dict["00101010"].vr).toBe("AS");
        expect(String(reRead.dict["00101010"].Value[0])).toBe(OVERLONG_AS);
        // untouched neighbors intact
        expect(String(reRead.dict["00080018"].Value[0])).toBe(
            "1.2.3.4.5.6.7.8.9"
        );
    });
});
