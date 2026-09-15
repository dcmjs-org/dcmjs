/**
 * Issue-derived regression tests — Object.prototype pollution tolerance.
 *
 * #10 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/10
 *   Symptom: in environments where Object.prototype has enumerable
 *   properties added (e.g. the meteor-based OHIF viewer), `for (let tag
 *   in dataset)` style iteration would treat the inherited property as a
 *   dataset element, corrupting naturalize/denaturalize/write. The fix
 *   was to iterate own keys only (Object.keys(...).forEach).
 *
 * This test pins the hardened behavior: with a polluted prototype, the
 * full naturalize → denaturalize → write → re-read cycle succeeds and no
 * "__polluted" key materializes anywhere in the output trees.
 */
import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

/** Collects paths whose object OWNS a __polluted key (inherited excluded). */
function findPolluted(obj, path, hits, seen = new Set()) {
    if (!obj || typeof obj !== "object" || obj instanceof ArrayBuffer) {
        return hits;
    }
    if (seen.has(obj)) return hits;
    seen.add(obj);
    if (Object.prototype.hasOwnProperty.call(obj, "__polluted")) {
        hits.push(path);
    }
    Object.keys(obj).forEach(k =>
        findPolluted(obj[k], `${path}.${k}`, hits, seen)
    );
    return hits;
}

describe("issue #10 — polluted Object.prototype must not corrupt the round trip", () => {
    afterEach(() => {
        delete Object.prototype.__polluted;
    });

    it("naturalize → denaturalize → write → read with an enumerable prototype property", () => {
         
        Object.prototype.__polluted = "x";
        try {
            const buffer = createSampleDicom({
                dict: {
                    "00081115": {
                        vr: "SQ",
                        Value: [{ "0020000E": { vr: "UI", Value: ["1.2.3"] } }]
                    },
                    "00100010": {
                        vr: "PN",
                        Value: [{ Alphabetic: "DOE^JANE" }]
                    }
                }
            });
            const dicomDict = DicomMessage.readFile(buffer);
            const dataset = DicomMetaDictionary.naturalizeDataset(
                dicomDict.dict
            );
            dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
            const written = dicomDict.write();

            // The written output must still parse...
            const reread = DicomMessage.readFile(written);
            expect(reread.dict["00081115"].Value[0]["0020000E"].Value).toEqual([
                "1.2.3"
            ]);
            expect(reread.dict["00100010"].Value[0].Alphabetic).toBe(
                "DOE^JANE"
            );

            // ...and no tree (naturalized, re-read dict, re-read meta) may
            // own a "__polluted" key.
            expect(findPolluted(dataset, "natural", [])).toEqual([]);
            expect(findPolluted(reread.dict, "dict", [])).toEqual([]);
            expect(findPolluted(reread.meta, "meta", [])).toEqual([]);
        } finally {
            delete Object.prototype.__polluted;
        }
    });
});
