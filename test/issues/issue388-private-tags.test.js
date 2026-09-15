/**
 * Issue-derived regression tests — private tags through the naturalizer.
 *
 * #388 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/388
 *   Upstream symptom (0.19.x): a SQ item containing private tags
 *   naturalized to numeric-string keys ("20051404"); the old
 *   addAccessors defined those keys ON the sequence array, so the array
 *   was extended to millions of undefined entries and denaturalization
 *   crashed with a TypeError.
 *   1.0 status: addAccessors uses a Proxy — the numeric-string keys stay
 *   on the ITEM, the sequence keeps length 1, and no TypeError occurs.
 *   Fixed in this arc: denaturalizeDataset also maps numeric-string keys
 *   back to their tags (VR recorded in _vrMap during naturalize), so the
 *   write → re-read round trip keeps the private elements.
 *
 * #215 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/215
 *   Upstream ask: custom/private tags should survive
 *   naturalize → denaturalize via a custom dictionary.
 *   1.0 status:
 *   - The supported path is the DicomMetaDictionary INSTANCE constructor:
 *     new DicomMetaDictionary(customDictionary).denaturalizeDataset(ds)
 *     keeps elements whose naturalized key matches a custom entry's
 *     `name` (pinned green below).
 *   - Fixed in this arc: the static path keeps unregistered private tags
 *     (numeric-string keys denaturalize back to their tag with the VR
 *     stored in _vrMap), and registerTag()-registered entries are taught
 *     to the lazy nameMap when first naturalized, so they denaturalize
 *     symmetrically.
 *
 * How private VRs resolve on read: src/index.js registers
 * dictionary.private.data.js via registerPrivatesModule(); explicit-VR
 * streams carry the VR anyway, so LO private elements read back as LO.
 */
import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const CREATOR = "ACME_PRIVATE_1.0";

function makeBuffer() {
    return createSampleDicom({
        dict: {
            // top-level private block (#215)
            "00090010": { vr: "LO", Value: [CREATOR] },
            "00091001": { vr: "LO", Value: ["private-top"] },
            // SQ whose single item mixes a standard tag with privates (#388)
            "00081115": {
                vr: "SQ",
                Value: [
                    {
                        "0020000E": { vr: "UI", Value: ["1.2.3.4"] },
                        "00090010": { vr: "LO", Value: [CREATOR] },
                        "00091001": { vr: "LO", Value: ["private-in-sq"] }
                    }
                ]
            }
        }
    });
}

describe("issue #388 — SQ items with private tags naturalize without accessor collision", () => {
    it("numeric-string keys land on the item; the sequence array is not extended", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(makeBuffer()).dict
        );
        const seq = dataset.ReferencedSeriesSequence;

        // The 0.19.x failure mode was seq.length exploding to 20051404+
        expect(Array.isArray(seq)).toBe(true);
        expect(seq.length).toBe(1);

        const item = seq[0];
        expect(Object.keys(item)).toEqual(
            expect.arrayContaining([
                "00090010",
                "00091001",
                "SeriesInstanceUID"
            ])
        );
        expect(item["00090010"]).toBe(CREATOR);
        expect(item["00091001"]).toBe("private-in-sq");
        expect(item.SeriesInstanceUID).toBe("1.2.3.4");

        // Proxy forwarding also resolves the private keys without throwing
        expect(seq["00091001"]).toBe("private-in-sq");
    });

    it("denaturalizing the mixed item does not throw and keeps the standard element", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(makeBuffer()).dict
        );
        // The upstream crash was a TypeError while traversing the
        // artificially extended sequence. 1.0 must not throw.
        const denaturalized = DicomMetaDictionary.denaturalizeDataset(dataset);
        expect(denaturalized["00081115"].Value.length).toBe(1);
        expect(denaturalized["00081115"].Value[0]["0020000E"].Value).toEqual([
            "1.2.3.4"
        ]);
    });

    // Fixed in this arc: naturalizeDataset records the VR of unmapped
    // (private) elements in _vrMap, and denaturalizeDataset maps 8-digit
    // hex keys straight back to their tag with that VR — recursively
    // inside SQ items — instead of dropping them.
    it("#388: private elements inside SQ items survive denaturalize → write → re-read", () => {
        const dicomDict = DicomMessage.readFile(makeBuffer());
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
        const reread = DicomMessage.readFile(dicomDict.write());
        const item = reread.dict["00081115"].Value[0];
        expect(item["00090010"].Value).toEqual([CREATOR]);
        expect(item["00091001"].Value).toEqual(["private-in-sq"]);
    });
});

describe("issue #215 — private/custom tags through naturalize → denaturalize", () => {
    it("top-level private tags naturalize to numeric-string keys with intact values", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(makeBuffer()).dict
        );
        expect(dataset["00090010"]).toBe(CREATOR);
        expect(dataset["00091001"]).toBe("private-top");
    });

    it("instance denaturalizeDataset with a custom dictionary preserves the private element", () => {
        // The supported custom-dictionary path: entries whose `name`
        // matches the naturalized key map back to their tag.
        const customDictionary = {
            "(0009,0010)": {
                tag: "(0009,0010)",
                vr: "LO",
                name: "00090010",
                vm: "1",
                version: "Custom"
            },
            "(0009,1001)": {
                tag: "(0009,1001)",
                vr: "LO",
                name: "00091001",
                vm: "1",
                version: "Custom"
            }
        };
        const instance = new DicomMetaDictionary(customDictionary);
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(makeBuffer()).dict
        );
        const denaturalized = instance.denaturalizeDataset(dataset);
        expect(denaturalized["00090010"].vr).toBe("LO");
        expect(denaturalized["00090010"].Value).toEqual([CREATOR]);
        expect(denaturalized["00091001"].vr).toBe("LO");
        expect(denaturalized["00091001"].Value).toEqual(["private-top"]);
    });

    // Fixed in this arc: static denaturalizeDataset maps numeric-string
    // keys ("00091001") back to their tag with the VR recorded in _vrMap
    // (UN when unknown), so unregistered private elements survive the
    // static naturalize → denaturalize round trip.
    it("#215: unregistered top-level private tags survive static denaturalize", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(makeBuffer()).dict
        );
        const denaturalized = DicomMetaDictionary.denaturalizeDataset(dataset);
        expect(denaturalized["00090010"]).toBeDefined();
        expect(denaturalized["00091001"]).toBeDefined();
    });

    // Fixed in this arc: naturalizeDataset now teaches the lazily-built
    // nameMap any non-standard dictionary entry it resolves (e.g. from
    // registerTag()), so static denaturalizeDataset maps the custom
    // keyword back to its tag — registration round-trips symmetrically.
    it("#215: registerTag() names naturalize and denaturalize (symmetric registration)", () => {
        const { registerTag } = require("../../src/dictionary.fast.js");
        registerTag("00091001", {
            name: "AcmePrivateValue",
            vr: "LO",
            vm: "1"
        });
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(makeBuffer()).dict
        );
        expect(dataset.AcmePrivateValue).toBe("private-top");
        const denaturalized = DicomMetaDictionary.denaturalizeDataset(dataset);
        expect(denaturalized["00091001"]).toBeDefined();
        expect(denaturalized["00091001"].Value).toEqual(["private-top"]);
    });
});
