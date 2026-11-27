/**
 * Overlay groups (60xx, xx even) in the naturalized form: one OverlaySequence
 * item for each group. See packages/core/src/utilities/overlaySequence.js.
 */
import dcmjs from "../../src/index.js";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { deepCloneInstance, setAttribute } from "@dcmjs-org/core";

const { DicomMetaDictionary } = dcmjs.data;

// `data` is a BulkDataURI string, or the bytes of OverlayData
const overlay = (group, rows, data) => ({
    [`${group}0010`]: { vr: "US", Value: [rows] },
    [`${group}0011`]: { vr: "US", Value: [rows * 2] },
    [`${group}0040`]: { vr: "CS", Value: ["G"] },
    [`${group}0050`]: { vr: "SS", Value: [1, 1] },
    [`${group}3000`]:
        typeof data === "string"
            ? { vr: "OW", BulkDataURI: data }
            : { vr: "OW", Value: [data] }
});

const bytes0 = new Uint8Array([1, 2]).buffer;
const bytes2 = new Uint8Array([3, 4]).buffer;

// Inline bytes: fromDataSet does not send an element-level BulkDataURI.
const twoOverlays = () => ({
    "00100020": { vr: "LO", Value: ["PID"] },
    ...overlay("6002", 32, bytes2),
    ...overlay("6000", 16, bytes0)
});

async function listenerNaturalize(dict) {
    const listener = new NaturalizedListener();
    await fromDataSet({ dict }, listener);
    return listener.result;
}

describe("OverlaySequence", () => {
    it("naturalizes each overlay group to one item, in both producers", async () => {
        const fromDict = DicomMetaDictionary.naturalizeDataset(twoOverlays());
        const fromEvents = await listenerNaturalize(twoOverlays());

        expect(fromEvents).toEqual(fromDict);
        expect(fromDict.OverlayRows).toBeUndefined();
        expect(fromDict.OverlaySequence).toEqual([
            {
                _vrMap: { OverlayData: "OW" },
                group: "6000",
                OverlayRows: 16,
                OverlayColumns: 32,
                OverlayType: "G",
                OverlayOrigin: [1, 1],
                OverlayData: [bytes0]
            },
            expect.objectContaining({ group: "6002", OverlayRows: 32 })
        ]);
    });

    it("gives one overlay as a sequence of one item", async () => {
        const fromDict = DicomMetaDictionary.naturalizeDataset(
            overlay("6000", 16, bytes0)
        );
        const fromEvents = await listenerNaturalize(
            overlay("6000", 16, bytes0)
        );

        for (const natural of [fromDict, fromEvents]) {
            expect(natural.OverlaySequence.OverlayRows).toBe(16);
            expect(natural.OverlaySequence[0].OverlayRows).toBe(16);
            expect(natural.OverlaySequence.length).toBe(1);
        }
    });

    it("keeps an odd 60xx group as a private tag", () => {
        const natural = DicomMetaDictionary.naturalizeDataset({
            60011001: { vr: "US", Value: [3] }
        });

        expect(natural.OverlaySequence).toBeUndefined();
        expect(natural["60011001"]).toEqual([3]);
    });

    it("denaturalizes each item to its group", () => {
        const source = {
            ...overlay("6000", 16, "uri0"),
            ...overlay("6002", 32, "uri2")
        };
        const dict = DicomMetaDictionary.denaturalizeDataset(
            DicomMetaDictionary.naturalizeDataset(source)
        );

        expect(Object.keys(dict).sort()).toEqual(Object.keys(source).sort());
        expect(dict["60020010"].Value).toEqual(["32"]);
        expect(dict["60023000"]).toEqual(
            expect.objectContaining({
                vr: "OW",
                Value: [{ BulkDataURI: "uri2" }]
            })
        );
    });

    it("gives each element a hex-tag alias that is not enumerable", async () => {
        const fromDict = DicomMetaDictionary.naturalizeDataset(twoOverlays());
        const fromEvents = await listenerNaturalize(twoOverlays());

        for (const natural of [fromDict, fromEvents]) {
            expect(natural["60020010"]).toBe(32);
            expect(natural["60003000"]).toEqual([bytes0]);
            expect(Object.keys(natural)).not.toContain("60020010");
            natural["60020010"] = 7;
            expect(natural.OverlaySequence[1].OverlayRows).toBe(7);
        }
        const clone = deepCloneInstance(fromDict);
        expect(clone["60020010"]).toBe(7);
    });

    it("leaves out an element whose alias was deleted", () => {
        const natural = DicomMetaDictionary.naturalizeDataset(twoOverlays());
        delete natural["60023000"];

        const dict = DicomMetaDictionary.denaturalizeDataset(natural);
        expect(dict["60023000"]).toBeUndefined();
        expect(dict["60003000"]).toBeDefined();
        expect(dict["60020010"].Value).toEqual(["32"]);
    });

    it("writes a flat overlay hex key to its group, and an item wins", () => {
        const dict = DicomMetaDictionary.denaturalizeDataset({
            _vrMap: { 60043000: "OW" },
            60040010: 5,
            60043000: [bytes2],
            60000010: 1,
            OverlaySequence: { group: "6000", OverlayRows: 2 }
        });

        expect(dict["60040010"]).toEqual({ vr: "US", Value: ["5"] });
        expect(dict["60043000"].vr).toBe("OW");
        expect(dict["60000010"].Value).toEqual(["2"]);
    });

    it("setAttribute of an overlay hex tag sets the item of its group", () => {
        const natural = DicomMetaDictionary.naturalizeDataset(
            overlay("6000", 16, bytes0)
        );
        setAttribute(natural, "60020010", 9);

        expect(natural.OverlayRows).toBeUndefined();
        expect(natural.OverlaySequence.map(item => item.group)).toEqual([
            "6000",
            "6002"
        ]);
        expect(natural.OverlaySequence[1].OverlayRows).toBe(9);
    });

    it("gives an item without a group the group of its position", () => {
        const dict = DicomMetaDictionary.denaturalizeDataset({
            OverlaySequence: [
                { OverlayRows: 4 },
                { OverlayRows: 8 },
                { group: 0x6010, OverlayRows: 12 }
            ]
        });

        expect(dict["60000010"].Value).toEqual(["4"]);
        expect(dict["60020010"].Value).toEqual(["8"]);
        expect(dict["60100010"].Value).toEqual(["12"]);
    });
});
