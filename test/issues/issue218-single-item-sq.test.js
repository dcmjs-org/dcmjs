/**
 * Issue-derived regression tests — single-item sequence naturalization.
 *
 * #218 (C — contract): https://github.com/dcmjs-org/dcmjs/issues/218
 *   Upstream symptom: naturalizeDataset turned one-item sequences into a
 *   bare object, so generic code like
 *   `PerFrameFunctionalGroupsSequence[frameNumber - 1]` broke when the
 *   sequence happened to have exactly one item.
 *   1.0 delta: single-item SQ values stay a length-1 Array wrapped in a
 *   Proxy (src/utilities/addAccessors.js, used by
 *   DicomMetaDictionary.naturalizeDataset), so BOTH access styles work:
 *   `seq[0].Field` (array style) and `seq.Field` (legacy object style,
 *   forwarded to item zero by the proxy).
 *
 * #273 (C — contract): https://github.com/dcmjs-org/dcmjs/issues/273
 *   Upstream symptom: SR generateReport produced naturalized datasets
 *   whose single-item sequences were plain objects, inconsistent with
 *   naturalizeDataset's proxy arrays.
 *   1.0 delta: the proxy-array shape is the single contract; here we pin
 *   that it survives a denaturalize → naturalize round trip unchanged
 *   (same shape, same values, both access styles intact).
 *
 * Related existing coverage (event-stream naturalizer):
 *   - test/eventStream/NaturalizedListener.test.js ("single-item sequence
 *     is the item object, with hidden length 1", §17 PN proxy tests)
 *   - test/data.test.js:1026 ("Compares denaturalized PersonName values
 *     and accessors")
 * This file pins the DicomMetaDictionary.naturalizeDataset path
 * specifically, which those suites do not exercise for single-item SQs.
 */
import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const SERIES_UID = "1.2.3.4.5";

function readNaturalized() {
    const buffer = createSampleDicom({
        dict: {
            "00081115": {
                vr: "SQ",
                Value: [
                    {
                        "0020000E": { vr: "UI", Value: [SERIES_UID] },
                        "00200011": { vr: "IS", Value: ["7"] }
                    }
                ]
            }
        }
    });
    const dicomDict = DicomMessage.readFile(buffer);
    return {
        dicomDict,
        dataset: DicomMetaDictionary.naturalizeDataset(dicomDict.dict)
    };
}

function expectSingleItemSqContract(seq) {
    // Array behavior stays sane
    expect(Array.isArray(seq)).toBe(true);
    expect(seq.length).toBe(1);
    // Array-style access (the #218 ask)
    expect(seq[0].SeriesInstanceUID).toBe(SERIES_UID);
    // Proxy object-style access (legacy compatibility, forwarded to item 0)
    expect(seq.SeriesInstanceUID).toBe(SERIES_UID);
}

describe("issue #218 — single-item SQ naturalizes to a proxy array (both access styles)", () => {
    it("ReferencedSeriesSequence with one item supports seq[0].Field and seq.Field", () => {
        const { dataset } = readNaturalized();
        expectSingleItemSqContract(dataset.ReferencedSeriesSequence);
    });

    it("writes through the proxy consistently (outer set visible via item zero)", () => {
        const { dataset } = readNaturalized();
        const seq = dataset.ReferencedSeriesSequence;
        // Setting an unknown prop through the proxy lands on item zero
        seq.SeriesNumber = 9;
        expect(seq[0].SeriesNumber).toBe(9);
    });

    it("JSON serialization of the proxy is the plain one-item array", () => {
        const { dataset } = readNaturalized();
        const json = JSON.parse(
            JSON.stringify(dataset.ReferencedSeriesSequence)
        );
        expect(Array.isArray(json)).toBe(true);
        expect(json.length).toBe(1);
        expect(json[0].SeriesInstanceUID).toBe(SERIES_UID);
    });
});

describe("issue #273 — single-item SQ shape survives denaturalize → naturalize", () => {
    it("round trips to the identical proxy-array contract", () => {
        const { dataset } = readNaturalized();
        const denaturalized = DicomMetaDictionary.denaturalizeDataset(dataset);

        // Denaturalized form is the DICOM JSON model shape again
        const sqEntry = denaturalized["00081115"];
        expect(sqEntry.vr).toBe("SQ");
        expect(Array.isArray(sqEntry.Value)).toBe(true);
        expect(sqEntry.Value.length).toBe(1);
        expect(sqEntry.Value[0]["0020000E"].Value).toEqual([SERIES_UID]);

        // Re-naturalizing restores the exact same access contract
        const renaturalized =
            DicomMetaDictionary.naturalizeDataset(denaturalized);
        expectSingleItemSqContract(renaturalized.ReferencedSeriesSequence);
    });

    it("survives a full write → re-read cycle unchanged", () => {
        const { dicomDict, dataset } = readNaturalized();
        dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
        const reread = DicomMessage.readFile(dicomDict.write());
        const again = DicomMetaDictionary.naturalizeDataset(reread.dict);
        expectSingleItemSqContract(again.ReferencedSeriesSequence);
    });
});
