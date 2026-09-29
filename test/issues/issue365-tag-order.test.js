/**
 * Written output must keep top-level tags in ascending order and grow the
 * write buffer when upserted values enlarge the dataset.
 *
 * Upstream issues (both triage category A - synthetic reproducer):
 * - #365 https://github.com/dcmjs-org/dcmjs/issues/365
 *   After editing a naturalized dataset (adding keywords whose tags sort
 *   BEFORE existing ones) and denaturalizing, dciodvfy reported "Tags out
 *   of order" on the written SEG. Pinned as: regardless of naturalized
 *   key insertion order, the writer emits top-level dataset tags in
 *   strictly ascending order (verified by walking the output bytes with
 *   the independent walker in test/issues/part10Walker.js).
 * - #196 https://github.com/dcmjs-org/dcmjs/issues/196
 *   Upserting patient demographic tags (notably a longer PatientName)
 *   before write threw "Error: Request more than currently allocated
 *   buffer". Pinned as: the write succeeds and the re-read values are
 *   intact when replaced values are much longer than the originals.
 */

import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";
import { walkTopLevelElements } from "./part10Walker.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const EXTRA_DICT = {
    "00080016": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.1"] },
    "00080018": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9"] },
    "00080020": { vr: "DA", Value: ["20200101"] },
    "00100010": { vr: "PN", Value: ["Doe^John"] },
    "00100020": { vr: "LO", Value: ["PID12345"] },
    "0020000D": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9.10"] },
    "0020000E": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9.11"] }
};

describe("issue #365 - tags stay in ascending order after naturalized edits", () => {
    it("keywords added out of tag order still write strictly ascending", () => {
        const dicomDict = DicomMessage.readFile(
            createSampleDicom({ dict: EXTRA_DICT })
        );
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);

        // Edit an existing element, then ADD keywords whose tags sort
        // BEFORE already-present ones - their naturalized insertion order
        // is the reverse of tag order.
        dataset.StudyDate = "20210202"; // existing (0008,0020)
        dataset.PatientBirthDate = "19800101"; // new (0010,0030) - after (0010,0020)
        dataset.PatientSex = "F"; // new (0010,0040)
        dataset.AccessionNumber = "ACC0001"; // new (0008,0050) - before (0010,xxxx)
        dataset.InstitutionName = "Issue365 Clinic"; // new (0008,0080)

        dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
        const outBuffer = dicomDict.write();

        const elements = walkTopLevelElements(outBuffer);
        const tags = elements.map(e => e.tag);

        // every added/edited element landed
        expect(tags).toEqual(
            expect.arrayContaining([
                "00080020",
                "00080050",
                "00080080",
                "00100030",
                "00100040"
            ])
        );

        // dciodvfy's complaint: tags out of order. Assert strictly ascending.
        for (let i = 1; i < tags.length; i++) {
            const previous = parseInt(tags[i - 1], 16);
            const current = parseInt(tags[i], 16);
            expect(current).toBeGreaterThan(previous);
        }

        // and the output re-reads with the edits intact
        const reRead = DicomMessage.readFile(outBuffer);
        expect(String(reRead.dict["00080020"].Value[0])).toBe("20210202");
        expect(String(reRead.dict["00100030"].Value[0])).toBe("19800101");
    });
});

describe("issue #196 - upserting longer values grows the write buffer", () => {
    it("a much longer PatientName (issue's upsert pattern) writes without 'Request more than currently allocated buffer'", () => {
        const dicomDict = DicomMessage.readFile(
            createSampleDicom({ dict: EXTRA_DICT })
        );

        // Verbatim pattern from the issue: overwrite dict entries directly.
        const longName =
            "Averyveryverylongpatientfamilyname^Equallylonggivenname^Middle";
        const longId = "a-much-longer-patient-identifier-than-before-0001";
        dicomDict.dict["00100010"] = { vr: "PN", Value: [longName] };
        dicomDict.dict["00100020"] = { vr: "LO", Value: [longId] };
        dicomDict.dict["00100030"] = { vr: "DA", Value: ["19700101"] };
        dicomDict.dict["00100040"] = { vr: "CS", Value: ["O"] };

        let outBuffer;
        expect(() => {
            outBuffer = dicomDict.write();
        }).not.toThrow();

        const reRead = DicomMessage.readFile(outBuffer);
        // re-read PN values surface as dicom+json objects ({ Alphabetic })
        const pn = reRead.dict["00100010"].Value[0];
        expect(String(pn.Alphabetic ?? pn)).toBe(longName);
        expect(String(reRead.dict["00100020"].Value[0])).toBe(longId);
        expect(String(reRead.dict["00100040"].Value[0])).toBe("O");
    });
});
