/**
 * Changing instance UIDs then rewriting must yield a valid Part 10 file.
 *
 * Upstream issue (triage category A - synthetic reproducer):
 * - #315 https://github.com/dcmjs-org/dcmjs/issues/315
 *   "Changing instance UID corrupts file, Invalid DICOM file, expected
 *   header is missing": readFile -> naturalizeDataset -> set a new UID ->
 *   denaturalizeDataset -> DicomDict.write() -> readFile reportedly threw
 *   "Invalid DICOM file, expected header is missing" on the re-read.
 *
 * Two flows are pinned:
 * 1. The issue's repro verbatim-ish: change StudyInstanceUID on the
 *    naturalized dataset, put the denaturalized dict back on the SAME
 *    DicomDict, write, re-read.
 * 2. The documented meta-update pattern (as used in #115's report and
 *    src/datasetToBlob.js): dataset._meta = namifyDataset(meta), change
 *    SOPInstanceUID, datasetToDict(dataset) - which rebuilds
 *    MediaStorageSOPInstanceUID from dataset.SOPInstanceUID - then write
 *    and re-read, asserting the new UID lands in BOTH dataset and meta.
 *
 * (The upstream reporter also wrapped the output in
 * `new ArrayBuffer(writeBuffer)` - a user-side footgun - but the triage
 * disposition pins the library-side contract: the written buffer itself
 * must re-read as valid Part 10 with the updated UIDs.)
 */

import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMessage, DicomMetaDictionary, datasetToDict } = dcmjs.data;

const EXTRA_DICT = {
    "00080016": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.1"] },
    "00080018": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9"] },
    "00100010": { vr: "PN", Value: ["Doe^John"] },
    "0020000D": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9.10"] },
    "0020000E": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9.11"] }
};

function makeBuffer() {
    return createSampleDicom({ dict: EXTRA_DICT });
}

describe("issue #315 - UID rewrite produces a valid Part 10 file", () => {
    it("StudyInstanceUID change (issue repro flow): write output re-reads with the new UID", () => {
        const dicomDict = DicomMessage.readFile(makeBuffer());
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        expect(dataset.StudyInstanceUID).toBe("1.2.3.4.5.6.7.8.9.10");

        const newUID = DicomMetaDictionary.uid();
        dataset.StudyInstanceUID = newUID;

        dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
        const outBuffer = dicomDict.write();

        // Gap symptom upstream: this re-read threw
        // "Invalid DICOM file, expected header is missing".
        let reRead;
        expect(() => {
            reRead = DicomMessage.readFile(outBuffer);
        }).not.toThrow();

        const reDataset = DicomMetaDictionary.naturalizeDataset(reRead.dict);
        expect(reDataset.StudyInstanceUID).toBe(newUID);
    });

    it("SOPInstanceUID change via the namifyDataset/datasetToDict pattern updates dataset AND meta", () => {
        const dicomDict = DicomMessage.readFile(makeBuffer());
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        dataset._meta = DicomMetaDictionary.namifyDataset(dicomDict.meta);

        const newUID = DicomMetaDictionary.uid();
        dataset.SOPInstanceUID = newUID;

        const outDicomDict = datasetToDict(dataset);
        const outBuffer = outDicomDict.write();

        let reRead;
        expect(() => {
            reRead = DicomMessage.readFile(outBuffer);
        }).not.toThrow();

        // dataset SOPInstanceUID (0008,0018)
        expect(reRead.dict["00080018"]).toBeDefined();
        expect(String(reRead.dict["00080018"].Value[0])).toBe(newUID);
        // meta MediaStorageSOPInstanceUID (0002,0003)
        expect(reRead.meta["00020003"]).toBeDefined();
        expect(String(reRead.meta["00020003"].Value[0])).toBe(newUID);
    });
});
