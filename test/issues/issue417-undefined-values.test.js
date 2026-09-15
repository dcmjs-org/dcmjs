/**
 * Elements whose Value is [undefined] must have DEFINED write behavior.
 *
 * Upstream issue (triage category A - synthetic reproducer):
 * - #417 https://github.com/dcmjs-org/dcmjs/issues/417
 *   Some read files produced dict entries with Value: [undefined]
 *   (observed on (0010,21C0) Pregnancy Status and (0018,9337)); write()
 *   then died deep in the buffer layer with the bare
 *   "Error: Not a number: undefined" (from toInt via
 *   WriteBufferStream.writeUint16) - no tag context, no way to know which
 *   element to fix.
 *
 * Defined behavior pinned here (either is acceptable):
 *   a) the element is skipped or written empty, and the output re-reads; or
 *   b) the write fails with a corrective error NAMING the offending tag.
 * 1.0 takes (b): DicomMessage.write annotates element-write failures with
 * the tag being written, preserving the underlying cause in the message.
 *
 * Also pins the naturalized-side contract: a naturalized field explicitly
 * set to undefined is OMITTED by denaturalizeDataset (the #418-family
 * drop behavior) and the subsequent write succeeds.
 *
 * validationLog is silenced (level 5): deliberately-garbage values are fed.
 */

import dcmjs from "../../src/index.js";
import { validationLog } from "../../src/log.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const EXTRA_DICT = {
    "00080016": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.1"] },
    "00080018": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9"] },
    "00100010": { vr: "PN", Value: ["Doe^John"] }
};

beforeAll(() => {
    validationLog.setLevel(5);
});

describe("issue #417 - dict entry with Value [undefined] has defined write behavior", () => {
    // Fixed in this arc: DicomMessage.write annotates element-write failures
    // with the tag being written, so the buffer-layer "Not a number:
    // undefined" now surfaces as a corrective error naming 001021C0.
    it("#417: write() on {vr:'US', Value:[undefined]} fails with a corrective error naming the tag", () => {
        const dicomDict = DicomMessage.readFile(
            createSampleDicom({ dict: EXTRA_DICT })
        );
        // The issue's observed shape, injected on the issue's tag.
        dicomDict.dict["001021C0"] = { vr: "US", Value: [undefined] };

        let outBuffer;
        let error;
        try {
            outBuffer = dicomDict.write();
        } catch (e) {
            error = e;
        }

        if (error) {
            // acceptable only if the error is corrective: names the element
            expect(String(error.message)).toMatch(
                /001021C0|\(0010,21C0\)|PregnancyStatus/i
            );
        } else {
            // acceptable: skipped or empty element, output still valid
            const reRead = DicomMessage.readFile(outBuffer);
            const entry = reRead.dict["001021C0"];
            const values = entry ? entry.Value || [] : [];
            expect(values.filter(v => v !== undefined && v !== null)).toEqual(
                []
            );
        }
    });

    it("write({allowInvalidVRLength:true}) - the issue's exact call - has the same defined-behavior contract", () => {
        // Same trigger through the reporter's exact write options; kept as
        // a separate pin because the option must not change the outcome.
        const dicomDict = DicomMessage.readFile(
            createSampleDicom({ dict: EXTRA_DICT })
        );
        dicomDict.dict["001021C0"] = { vr: "US", Value: [undefined] };

        let error;
        try {
            dicomDict.write({ allowInvalidVRLength: true });
        } catch (e) {
            error = e;
        }

        // The write throws the same annotated error as the default-options
        // path: the underlying buffer failure is preserved in the message
        // and the offending tag is named.
        expect(error).toBeDefined();
        expect(String(error.message)).toMatch(/Not a number: undefined/);
        expect(String(error.message)).toMatch(/001021C0/i);
    });
});

describe("issue #417 (naturalized side) - field set to undefined is omitted and write succeeds", () => {
    it("denaturalizeDataset omits the undefined field; write and re-read succeed", () => {
        const dicomDict = DicomMessage.readFile(
            createSampleDicom({ dict: EXTRA_DICT })
        );
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        dataset.PatientName = undefined;

        let denaturalized;
        expect(() => {
            denaturalized = DicomMetaDictionary.denaturalizeDataset(dataset);
        }).not.toThrow();
        // the undefined field is dropped, not emitted as [undefined]
        expect(denaturalized["00100010"]).toBeUndefined();

        dicomDict.dict = denaturalized;
        const outBuffer = dicomDict.write();
        const reRead = DicomMessage.readFile(outBuffer);
        expect(reRead.dict["00100010"]).toBeUndefined();
        expect(String(reRead.dict["00080018"].Value[0])).toBe(
            "1.2.3.4.5.6.7.8.9"
        );
    });
});
