/**
 * Private reserved blocks in the naturalized form (PS3.5 7.8.1): both
 * naturalizers give the same `${group}:${creator}` blocks, and every write
 * path undoes them. See packages/core/src/utilities/privateBlocks.js.
 */
import dcmjs from "../../src/index.js";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { fromNaturalized } from "../../src/eventStream/fromNaturalized";
import { Part10Writer } from "../../src/eventStream/Part10Writer";
import { definePrivateAliases, setAttribute } from "@dcmjs-org/core";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

// Two groups with the same creator at the same xx, a creator listed after
// its data, a private element without a creator, and a sequence item.
function sourceDict() {
    return {
        "00100020": { vr: "LO", Value: ["PID"] },
        "00080008": { vr: "CS" }, // ImageType, VM 2-n, present with no Value
        60000010: { vr: "US", Value: [512] }, // OverlayRows, a repeating group
        "00311001": { vr: "LO" }, // private, no creator, no Value
        "00091001": { vr: "LO", Value: ["nine"] },
        "00090010": { vr: "LO", Value: ["ACME"] },
        "00290010": { vr: "LO", Value: ["ACME"] },
        "00291001": { vr: "US", Value: [7] },
        "00291102": { vr: "LO", Value: ["orphan"] },
        "00400100": {
            vr: "SQ",
            Value: [
                {
                    "00290010": { vr: "LO", Value: ["ITEM"] },
                    "00291005": { vr: "LO", Value: ["in-item"] }
                }
            ]
        }
    };
}

async function listenerNaturalize(dict) {
    const listener = new NaturalizedListener();
    await fromDataSet({ dict }, listener);
    return listener.result;
}

describe("private reserved blocks", () => {
    it("naturalizeDataset and NaturalizedListener give the same object", async () => {
        const fromDict = DicomMetaDictionary.naturalizeDataset(sourceDict());
        const fromEvents = await listenerNaturalize(sourceDict());

        expect(fromEvents).toEqual(fromDict);
        expect(fromDict["0009:ACME"]).toEqual({
            creator: "ACME",
            reservedBlock: 0x10,
            x01: ["nine"]
        });
        expect(fromDict["0029:ACME"]).toEqual({
            creator: "ACME",
            reservedBlock: 0x10,
            x01: [7]
        });
        expect(fromDict._vrMap["0029:ACME"]).toEqual({ x01: "US" });
        expect(fromDict["00291102"]).toEqual(["orphan"]);
        expect(
            fromDict.ScheduledProcedureStepSequence["0029:ITEM"].x05
        ).toEqual(["in-item"]);
        for (const naturalized of [fromDict, fromEvents]) {
            expect(naturalized["00291001"]).toEqual([7]);
            expect(naturalized["00090010"]).toBe("ACME");
            // present and empty: [] for a list VM (NAT-U-VAL-2, NAT-U-VAL-4)
            expect(naturalized.ImageType).toEqual([]);
            expect(naturalized["00311001"]).toEqual([]);
            expect(naturalized.OverlayRows).toBe(512);
        }
    });

    it("a creator read as UN bytes, or as InlineBinary, gives its text as the block key", async () => {
        const unCreatorDict = () => ({
            "7FDD0010": {
                vr: "UN",
                Value: [new TextEncoder().encode("TSC Private Group ").buffer]
            },
            "7FDD1001": { vr: "UN", Value: [new ArrayBuffer(2)] },
            "7FDF0010": { vr: "UN", InlineBinary: "QUNNRQ==" }, // "ACME"
            // a malformed 2 MB creator value must not stop the naturalizer
            "7FE10010": { vr: "UN", Value: [new ArrayBuffer(2 ** 21)] }
        });
        const fromDict = DicomMetaDictionary.naturalizeDataset(unCreatorDict());
        const fromEvents = await listenerNaturalize(unCreatorDict());

        expect(Object.keys(fromDict["7FDD:TSC Private Group"])).toEqual([
            "creator",
            "reservedBlock",
            "x01"
        ]);
        expect(fromDict["7FDF:ACME"]).toBeDefined();
        expect(Object.keys(fromEvents)).toEqual(Object.keys(fromDict));
    });

    it("a hex alias writes through to its block, also after the block is replaced", () => {
        const naturalized = DicomMetaDictionary.naturalizeDataset(sourceDict());
        naturalized["00291001"] = 9;
        expect(naturalized["0029:ACME"].x01).toBe(9);
        naturalized["0029:ACME"] = { ...naturalized["0029:ACME"], x01: 10 };
        expect(naturalized["00291001"]).toBe(10);
        const dict = DicomMetaDictionary.denaturalizeDataset(naturalized);
        expect(Number(dict["00291001"].Value[0])).toBe(10);
    });

    it("a delete of a hex alias removes the element, and of a creator alias the block, on both write paths", async () => {
        const naturalized = DicomMetaDictionary.naturalizeDataset(sourceDict());
        delete naturalized["00291001"];
        delete naturalized["00090010"];
        // a later re-define must not bring the deleted alias back
        definePrivateAliases(naturalized);
        const dict = DicomMetaDictionary.denaturalizeDataset(naturalized);

        expect(dict["00291001"]).toBeUndefined();
        expect(dict["00290010"].Value).toEqual(["ACME"]);
        expect(dict["00090010"]).toBeUndefined();
        expect(dict["00091001"]).toBeUndefined();

        naturalized._meta = { TransferSyntaxUID: "1.2.840.10008.1.2.1" };
        const writer = new Part10Writer();
        await fromNaturalized(naturalized, writer);
        const back = DicomMessage.readFile(writer.write()).dict;
        expect(back["00291001"]).toBeUndefined();
        expect(back["00091001"]).toBeUndefined();
    });

    it("a delete always wins, also over a rewrite or a copied block", () => {
        const naturalized = DicomMetaDictionary.naturalizeDataset(sourceDict());
        naturalized["0029:ACME"].x01 = ["changed"]; // a rewrite before
        delete naturalized["00291001"];
        naturalized["0029:ACME"] = { ...naturalized["0029:ACME"], x01: [8] };
        expect(
            DicomMetaDictionary.denaturalizeDataset(naturalized)["00291001"]
        ).toBeUndefined();
    });

    it("each Object.create child of a dataset gets the aliases of its own blocks", () => {
        const parent = DicomMetaDictionary.naturalizeDataset(sourceDict());
        const child = value => {
            const item = Object.create(parent);
            item["0035:CHILD"] = {
                creator: "CHILD",
                reservedBlock: 0x10,
                x01: [value]
            };
            definePrivateAliases(item);
            return item;
        };
        const first = child(1);
        const second = child(2);

        expect(first["00351001"]).toEqual([1]);
        expect(second["00351001"]).toEqual([2]);
        expect(
            DicomMetaDictionary.denaturalizeDataset(second)["00350010"]
        ).toBeDefined();
        expect("00351001" in parent).toBe(false);
        expect(parent[Symbol.for("dcmjs.privateAliases")].has("00351001")).toBe(
            false
        );
        // a child block that replaces a parent block is written, not deleted
        const copy = Object.create(parent);
        copy["0029:ACME"] = { ...parent["0029:ACME"], x01: [8] };
        const dict = DicomMetaDictionary.denaturalizeDataset(copy);
        expect(Number(dict["00291001"].Value[0])).toBe(8);
    });

    it("a write on an Object.create child changes the child, not the parent", () => {
        const parent = DicomMetaDictionary.naturalizeDataset({
            ...sourceDict(),
            "00100010": { vr: "PN", Value: [{ Alphabetic: "Parent^One" }] }
        });
        const item = Object.create(parent);
        item["00291001"] = [99];
        item.PatientName = "Child^Two";
        setAttribute(item, "00431001", ["x"], { vr: "SH" });

        expect(item["00291001"]).toEqual([99]);
        expect(String(item.PatientName)).toBe("Child^Two");
        expect(parent["0029:ACME"].x01).toEqual([7]);
        expect(String(parent.PatientName)).toBe("Parent^One");
        expect(parent._vrMap["00431001"]).toBeUndefined();
        expect(
            DicomMetaDictionary.denaturalizeDataset(item)["00291001"].Value
        ).toEqual(["99"]);
        // an alias of the parent reads the block that the child holds
        const other = Object.create(parent);
        other["0029:ACME"] = { ...parent["0029:ACME"], x01: [8] };
        expect(other["00291001"]).toEqual([8]);
    });

    it("a write to a hex alias after the block or its creator is deleted makes a flat element", () => {
        const naturalized = DicomMetaDictionary.naturalizeDataset(sourceDict());
        delete naturalized["0029:ACME"];
        naturalized["00291001"] = 5;
        delete naturalized["00090010"]; // the creator alias of "0009:ACME"
        naturalized["00091001"] = "flat";
        const dict = DicomMetaDictionary.denaturalizeDataset(naturalized);

        expect(dict["00291001"]).toEqual({ vr: "US", Value: ["5"] });
        expect(dict["00290010"]).toBeUndefined();
        expect(dict["00091001"].Value).toEqual(["flat"]);
        expect(dict["00090010"]).toBeUndefined();
    });

    it("a value set on a deleted hex alias replaces the deleted element", () => {
        const naturalized = DicomMetaDictionary.naturalizeDataset(sourceDict());
        delete naturalized["00291001"];
        naturalized["00291001"] = [99];
        // no _vrMap entry: the flat element takes the VR of the block element
        const dict = DicomMetaDictionary.denaturalizeDataset(naturalized);

        expect(dict["00290010"].Value).toEqual(["ACME"]);
        expect(dict["00291001"]).toEqual({ vr: "US", Value: ["99"] });
        expect(dict["00290011"]).toBeUndefined();
    });

    it("a flat element in the range of a block joins it, and a flat keyword holds its block", () => {
        const { registerTag } = require("../../src/dictionary.fast.js");
        registerTag("00331001", { name: "FlatPrivateKeyword", vr: "LO" });
        const naturalized = DicomMetaDictionary.naturalizeDataset(sourceDict());
        naturalized["00291002"] = "added";
        naturalized._vrMap["00291002"] = "LO";
        naturalized.FlatPrivateKeyword = "flat";
        naturalized["0033:NEW"] = {
            creator: "NEW",
            reservedBlock: 0x10,
            x01: "new"
        };
        naturalized._vrMap["0033:NEW"] = { x01: "LO" };
        const dict = DicomMetaDictionary.denaturalizeDataset(naturalized);

        // 00291002 is in block 0x10 of "0029:ACME", so it stays at 0x10
        expect(dict["00290010"].Value).toEqual(["ACME"]);
        expect(dict["00291002"].Value).toEqual(["added"]);
        // the keyword holds 0x10 of group 0033, so "0033:NEW" moves to 0x11
        expect(dict["00331001"].Value).toEqual(["flat"]);
        expect(dict["00330011"].Value).toEqual(["NEW"]);
        expect(dict["00331101"].Value).toEqual(["new"]);
    });

    it("a creator that reserves two blocks in one group gives a warning", () => {
        const warn = jest.spyOn(dcmjs.log, "warn").mockImplementation(() => {});
        DicomMetaDictionary.naturalizeDataset({
            "00290010": { vr: "LO", Value: ["ACME"] },
            "00290011": { vr: "LO", Value: ["ACME"] }
        });
        expect(warn.mock.calls.flat().join(" ")).toMatch(
            /"ACME" reserves two blocks in group 0029/
        );
        warn.mockRestore();
    });

    it("denaturalize keeps a free reservedBlock and moves a taken one", () => {
        const dict = DicomMetaDictionary.denaturalizeDataset({
            _vrMap: {
                "00290010": "LO",
                "00291010": "LO",
                "0029:MOVED": { x01: "LO" },
                "0029:KEPT": { x01: "LO" }
            },
            "00290010": "OLD FORM",
            "00291010": "flat",
            "0029:MOVED": { creator: "MOVED", reservedBlock: 0x10, x01: "m" },
            "0029:KEPT": { creator: "KEPT", reservedBlock: 0x12, x01: "k" }
        });

        expect(dict["00290010"].Value).toEqual(["OLD FORM"]);
        expect(dict["00291010"].Value).toEqual(["flat"]);
        expect(dict["00290012"].Value).toEqual(["KEPT"]);
        expect(dict["00291201"].Value).toEqual(["k"]);
        // 0x10 and 0x12 are taken, so MOVED gets the first free block
        expect(dict["00290011"].Value).toEqual(["MOVED"]);
        expect(dict["00291101"].Value).toEqual(["m"]);
    });

    it("a block element with no _vrMap entry takes the private dictionary VR", () => {
        const dict = DicomMetaDictionary.denaturalizeDataset({
            "0029:SIEMENS CSA HEADER": {
                creator: "SIEMENS CSA HEADER",
                reservedBlock: 0x10,
                x08: "IMAGE NUM 4", // CSAImageHeaderType, CS
                x99: "unknown"
            }
        });
        expect(dict["00291008"].vr).toBe("CS");
        // no recorded VR and no dictionary entry: skipped, never unwritable
        expect(dict["00291099"]).toBeUndefined();
    });

    it("fromNaturalized writes the blocks back to Part 10", async () => {
        const naturalized = DicomMetaDictionary.naturalizeDataset(sourceDict());
        const writer = new Part10Writer();
        await fromNaturalized(
            {
                ...naturalized,
                _meta: {
                    TransferSyntaxUID: "1.2.840.10008.1.2.1",
                    _vrMap: {}
                }
            },
            writer
        );
        const back = DicomMessage.readFile(writer.write()).dict;

        expect(back["00090010"].Value).toEqual(["ACME"]);
        expect(back["00091001"].Value).toEqual(["nine"]);
        expect(back["00291001"].Value).toEqual([7]);
        expect(back["00291102"].Value).toEqual(["orphan"]);
        expect(back["00400100"].Value[0]["00291005"].Value).toEqual([
            "in-item"
        ]);
    });
});

describe("private reserved blocks on a real file", () => {
    it("naturalize, denaturalize, write and read keep every private element", () => {
        const fs = require("fs");
        const bytes = fs.readFileSync(
            require("path").join(
                __dirname,
                "../../packages/fixtures/testImages/CT1_UNC.explicit_little_endian.dcm"
            )
        );
        const source = DicomMessage.readFile(
            bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength
            )
        );
        const privateTags = Object.keys(source.dict).filter(
            tag => parseInt(tag.slice(0, 4), 16) & 1
        );
        expect(privateTags.length).toBeGreaterThan(100);

        const naturalized = DicomMetaDictionary.naturalizeDataset(source.dict);
        source.dict = DicomMetaDictionary.denaturalizeDataset(naturalized);
        const back = DicomMessage.readFile(source.write()).dict;

        // a second read: source.dict is replaced above
        const originals = DicomMessage.readFile(
            bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength
            )
        ).dict;
        for (const tag of privateTags) {
            const original = originals[tag];
            expect({ tag, vr: back[tag]?.vr }).toEqual({
                tag,
                vr: original.vr
            });
            expect({ tag, Value: back[tag].Value }).toEqual({
                tag,
                Value: original.Value
            });
        }
    });
});
