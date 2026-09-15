/**
 * Upstream issue: https://github.com/dcmjs-org/dcmjs/issues/404
 *
 * Symptom: after rawValue retention landed, serializing a parsed dataset
 * leaked the non-standard `_rawValue` key into DICOM JSON output; the
 * PS3.18 F.2 JSON schema has no such member, so standard consumers of the
 * previous output format could no longer read it.
 *
 * Triage category: C (contract assertion). How 1.0 deliberately differs
 * from the upstream report: rawValue retention is an internal DicomDict
 * concern for lossless write-back (see test/lossless-read-write.test.js);
 * the DICOM JSON model sink (DicomWebJsonWriter via toDicomWebJson) emits
 * only the standard {vr, Value | BulkDataURI | InlineBinary} shape — no
 * opt-in formatting flag is needed because the schema-clean output is the
 * only JSON-model output.
 */
import dcmjs from "../../src/index.js";

const { DicomDict } = dcmjs.data;
const { DicomEventStream } = dcmjs.eventStream;

const ELE = "1.2.840.10008.1.2.1";

/** Recursively collect every object key in a JSON-like tree. */
function collectKeys(node, keys = new Set()) {
    if (Array.isArray(node)) {
        node.forEach(item => collectKeys(item, keys));
    } else if (node && typeof node === "object") {
        for (const key of Object.keys(node)) {
            keys.add(key);
            collectKeys(node[key], keys);
        }
    }
    return keys;
}

describe("issue #404 — DICOM JSON model output is schema-clean", () => {
    async function buildJson() {
        const d = new DicomDict({
            "00020010": { vr: "UI", Value: [ELE] },
            "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
            "00020003": { vr: "UI", Value: ["1.2.3.4"] }
        });
        // read-style entries carrying _rawValue, including one nested in a
        // sequence item, so the deep scan exercises the whole tree
        d.dict["00181041"] = { vr: "DS", _rawValue: ["1.0000"], Value: [1] };
        d.dict["00200013"] = { vr: "IS", _rawValue: ["010"], Value: [10] };
        d.dict["00400275"] = {
            vr: "SQ",
            Value: [
                {
                    "00181041": {
                        vr: "DS",
                        _rawValue: ["+2.500"],
                        Value: [2.5]
                    }
                }
            ]
        };
        const bytes = d.write();
        return DicomEventStream.fromPart10(bytes).toDicomWebJson();
    }

    it("contains no _rawValue keys anywhere in the tree", async () => {
        const json = await buildJson();
        const keys = collectKeys(json);
        expect(keys.has("_rawValue")).toBe(false);
        expect(keys.has("rawValue")).toBe(false);
        // and the JSON round-trips through the serializer without them
        expect(JSON.stringify(json)).not.toContain("_rawValue");
    });

    it("emits only standard attribute members ({vr, Value ...})", async () => {
        const json = await buildJson();

        expect(json["00181041"]).toEqual({ vr: "DS", Value: [1] });
        expect(json["00200013"]).toEqual({ vr: "IS", Value: [10] });
        // sequence item element is equally clean
        expect(json["00400275"].Value[0]["00181041"]).toEqual({
            vr: "DS",
            Value: [2.5]
        });
    });
});
