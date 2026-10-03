/**
 * Issue-derived regression tests — naturalizer keyword/value contract.
 *
 * #3 (C — contract): https://github.com/dcmjs-org/dcmjs/issues/3
 *   Upstream symptom: early dcmjs dropped "UID" from naturalized names
 *   (SOPClassUID -> SOPClass), which made MappingResource (0008,0105)
 *   and MappingResourceUID (0008,0118) collide.
 *   1.0 delta: keywords are taken verbatim from the data dictionary, so
 *   both naturalize to their DISTINCT full keywords.
 *
 * #6 (C — contract): https://github.com/dcmjs-org/dcmjs/issues/6
 *   Upstream symptom: the NDD naming rules — don't drop "UID"/"Sequence"
 *   from tag names, don't auto-convert UID values to symbolic names.
 *   1.0 delta: keywords keep their suffixes and UID VALUES stay the UID
 *   string (naturalized SOPClassUID === "1.2.840.10008..." — never
 *   "MRImage").
 *
 * #114 (C — contract): https://github.com/dcmjs-org/dcmjs/issues/114
 *   Upstream question: should the naturalizer unpack OverlayData /
 *   palette LUT bulk into bit/entry arrays?
 *   1.0 delta (deliberate): NO — bulk binary stays binary. Naturalized
 *   OverlayData (6000,3000) remains an ArrayBuffer of the original
 *   bytes, not an unpacked per-pixel bit array.
 *
 * #263 (A — synthetic): https://github.com/dcmjs-org/dcmjs/issues/263
 *   Symptom: 0.18.11 naturalizeDataset ballooned small datasets to
 *   300 MB+ JSON full of thousands of injected nulls. Pin: no value
 *   array in the naturalized output contains null entries.
 *
 * Related existing coverage: test/eventStream/NaturalizedListener.test.js
 * covers keyword mapping on the event-stream path; this file pins
 * DicomMetaDictionary.naturalizeDataset.
 */
import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.4"; // MRImage in sopClassNamesByUID
const MAPPING_RESOURCE_UID = "1.2.840.10008.8.1.1";
const OVERLAY_BYTES = 64;

function readNaturalized() {
    const buffer = createSampleDicom({
        dict: {
            "00080016": { vr: "UI", Value: [SOP_CLASS_UID] },
            "00080105": { vr: "CS", Value: ["DCMR"] },
            "00080118": { vr: "UI", Value: [MAPPING_RESOURCE_UID] },
            "00081115": {
                vr: "SQ",
                Value: [{ "0020000E": { vr: "UI", Value: ["1.2.3.4"] } }]
            },
            60003000: {
                vr: "OW",
                Value: [new Uint8Array(OVERLAY_BYTES).fill(0xff).buffer]
            }
        }
    });
    return DicomMetaDictionary.naturalizeDataset(
        DicomMessage.readFile(buffer).dict
    );
}

describe("issues #3/#6 — dictionary keywords are used verbatim", () => {
    it("MappingResource and MappingResourceUID naturalize to distinct full keywords", () => {
        const dataset = readNaturalized();
        expect(dataset.MappingResource).toBe("DCMR");
        expect(dataset.MappingResourceUID).toBe(MAPPING_RESOURCE_UID);
        // No collapsed 'MappingResource'-only survivor: both keys coexist
        expect(Object.keys(dataset)).toEqual(
            expect.arrayContaining(["MappingResource", "MappingResourceUID"])
        );
    });

    it("keywords keep their 'Sequence' and 'UID' suffixes", () => {
        const dataset = readNaturalized();
        expect(dataset.ReferencedSeriesSequence).toBeDefined();
        expect(dataset.ReferencedSeries).toBeUndefined();
        expect(dataset.SOPClassUID).toBeDefined();
        expect(dataset.SOPClass).toBeUndefined();
    });

    it("UID values are not replaced by symbolic names", () => {
        const dataset = readNaturalized();
        // The value stays the UID string, even though a name mapping
        // exists (DicomMetaDictionary.sopClassNamesByUID has this UID).
        expect(DicomMetaDictionary.sopClassNamesByUID[SOP_CLASS_UID]).toBe(
            "MRImage"
        );
        expect(dataset.SOPClassUID).toBe(SOP_CLASS_UID);
    });
});

describe("issue #114 — naturalizer does NOT unpack OverlayData (deliberate contract)", () => {
    it("OverlayData (6000,3000) stays binary ArrayBuffer, not a bit array", () => {
        const dataset = readNaturalized();
        const overlay = dataset.OverlayData;
        expect(overlay).toBeDefined();
        // Single-element binary value: proxy array of one ArrayBuffer
        const buffer = Array.isArray(overlay) ? overlay[0] : overlay;
        expect(buffer).toBeInstanceOf(ArrayBuffer);
        // The bytes are untouched — NOT unpacked into rows*columns bit
        // entries (which would be 8x larger, or a plain number array).
        expect(buffer.byteLength).toBe(OVERLAY_BYTES);
        expect(new Uint8Array(buffer)[0]).toBe(0xff);
    });
});

describe("issue #263 — no injected null padding in naturalized output", () => {
    it("no value array in the naturalized dataset contains null entries", () => {
        const dataset = readNaturalized();
        const offenders = [];
        const scan = (value, path, seen = new Set()) => {
            if (!value || typeof value !== "object") return;
            if (value instanceof ArrayBuffer) return;
            if (seen.has(value)) return;
            seen.add(value);
            if (Array.isArray(value)) {
                if (value.some(entry => entry === null)) {
                    offenders.push(path);
                }
                value.forEach((entry, i) => scan(entry, `${path}[${i}]`, seen));
                return;
            }
            Object.keys(value).forEach(key =>
                scan(value[key], `${path}.${key}`, seen)
            );
        };
        scan(dataset, "dataset");
        expect(offenders).toEqual([]);

        // And the serialized form shows no ":null" storms (the 300MB
        // regression signature was thousands of consecutive nulls).
        const json = JSON.stringify(dataset, (key, value) =>
            value instanceof ArrayBuffer ? `[${value.byteLength} bytes]` : value
        );
        expect(json).not.toMatch(/(null,){10,}/);
        expect(json.length).toBeLessThan(100000);
    });
});
