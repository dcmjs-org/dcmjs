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
 * Fixed behavior: the element is written empty (zero length), and the
 * output re-reads (NAT-U-RT-7 in docs/specs/naturalized-dataset.md).
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
    // Fixed: Tag.write gives an element with only undefined entries no
    // value (NAT-U-RT-7), so the element is written with zero length.
    for (const writeOptions of [undefined, { allowInvalidVRLength: true }]) {
        it(`write(${
            JSON.stringify(writeOptions) ?? ""
        }) on {vr:'US', Value:[undefined]} writes an empty element`, () => {
            const dicomDict = DicomMessage.readFile(
                createSampleDicom({ dict: EXTRA_DICT })
            );
            // The issue's observed shape, injected on the issue's tag.
            dicomDict.dict["001021C0"] = { vr: "US", Value: [undefined] };

            const reRead = DicomMessage.readFile(dicomDict.write(writeOptions));
            // the reader gives a zero-length US as its default value, 0
            expect(reRead.dict["001021C0"].Value).not.toContain(undefined);
            expect(String(reRead.dict["00080018"].Value[0])).toBe(
                "1.2.3.4.5.6.7.8.9"
            );
        });
    }
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
