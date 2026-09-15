/**
 * Issue-derived regression tests — PersonName naturalization contract.
 *
 * #231 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/231
 *   Symptom: naturalizeDataset called twice over the same dict (or over
 *   PN values that were already naturalized objects) threw
 *   "TypeError: Cannot redefine property: Alphabetic" because the old
 *   addAccessors used Object.defineProperty per key. 1.0's addAccessors
 *   (src/utilities/addAccessors.js) uses a Proxy and marks proxies via
 *   __isProxy, so re-naturalization must not throw.
 *
 * #381 (C — contract): https://github.com/dcmjs-org/dcmjs/issues/381
 *   Upstream symptom: PN naturalized as a union of object and string broke
 *   DIMSE consumers that expect a plain string.
 *   1.0 delta: naturalized PN is a proxy array of DICOM JSON component
 *   objects ([{ Alphabetic }]) that still provides the plain-string path:
 *   String(pn) / pn.toString() yields the Part 10 PN string, and
 *   pn.Alphabetic reads the component directly.
 *
 * #413 (C — contract): https://github.com/dcmjs-org/dcmjs/issues/413
 *   Upstream symptom: after naturalize → denaturalize → write, PN tags
 *   showed garbled characters in some viewers (the [{Alphabetic}] object
 *   shape leaked into the written bytes).
 *   1.0 delta: writing the naturalized form back produces valid PN bytes;
 *   a re-read yields the identical Alphabetic value and raw string.
 *
 * Related existing coverage:
 *   - test/eventStream/NaturalizedListener.test.js §17 (PN proxies on the
 *     event-stream path)
 *   - test/data.test.js:681 (PN multiplicity), :1026 (denaturalized PN
 *     accessors)
 * Neutral names only (DOE^JANE / FOX^JANE).
 */
import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

function makePnBuffer() {
    return createSampleDicom({
        dict: {
            "00100010": { vr: "PN", Value: [{ Alphabetic: "DOE^JANE" }] },
            "00081070": { vr: "PN", Value: [{ Alphabetic: "FOX^JANE" }] }
        }
    });
}

describe("issue #231 — repeated naturalization must not redefine PN accessors", () => {
    it("naturalizeDataset twice over the same read dict does not throw", () => {
        const dicomDict = DicomMessage.readFile(makePnBuffer());
        const first = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        expect(first.PatientName.Alphabetic).toBe("DOE^JANE");

        // The upstream crash: second pass over the same dict threw
        // "Cannot redefine property: Alphabetic".
        const second = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        expect(second.PatientName.Alphabetic).toBe("DOE^JANE");
        expect(second.OperatorsName.Alphabetic).toBe("FOX^JANE");
    });

    it("naturalizing a dict whose PN values are already naturalized objects does not throw", () => {
        const dict = {
            "00100010": { vr: "PN", Value: [{ Alphabetic: "DOE^JANE" }] }
        };
        const first = DicomMetaDictionary.naturalizeDataset(dict);
        expect(first.PatientName.Alphabetic).toBe("DOE^JANE");
        const second = DicomMetaDictionary.naturalizeDataset(dict);
        expect(second.PatientName.Alphabetic).toBe("DOE^JANE");
    });
});

describe("issues #381/#413 — PN union contract and write-back", () => {
    it("naturalized PN is a proxy array of component objects with a string path", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(makePnBuffer()).dict
        );
        const pn = dataset.PatientName;

        // DICOM JSON model shape: [{ Alphabetic }] (proxy array of 1)
        expect(Array.isArray(pn)).toBe(true);
        expect(pn.length).toBe(1);
        expect(pn[0].Alphabetic).toBe("DOE^JANE");
        // Proxy forwards component access
        expect(pn.Alphabetic).toBe("DOE^JANE");
        // Plain-string comparison path for DIMSE-style consumers (#381)
        expect(String(pn)).toBe("DOE^JANE");
        expect(`${pn}` === "DOE^JANE").toBe(true);
        // JSON output stays the DICOM JSON component array
        expect(JSON.parse(JSON.stringify(pn))).toEqual([
            { Alphabetic: "DOE^JANE" }
        ]);
    });

    it("naturalized PN writes back to valid PN bytes (re-read equals original)", () => {
        const dicomDict = DicomMessage.readFile(makePnBuffer());
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);

        dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
        const written = dicomDict.write();

        const reread = DicomMessage.readFile(written);
        // Valid PN bytes: raw string is exactly the Part 10 PN encoding
        expect(reread.dict["00100010"]._rawValue).toBe("DOE^JANE");
        expect(reread.dict["00100010"].Value[0].Alphabetic).toBe("DOE^JANE");
        expect(reread.dict["00081070"].Value[0].Alphabetic).toBe("FOX^JANE");

        const again = DicomMetaDictionary.naturalizeDataset(reread.dict);
        expect(String(again.PatientName)).toBe("DOE^JANE");
        expect(String(again.OperatorsName)).toBe("FOX^JANE");
    });
});
