import { DicomMetaDictionary } from "../src/DicomMetaDictionary";

const overlay = (group, rows, uri) => ({
    [`${group}0010`]: { vr: "US", Value: [rows] },
    [`${group}0011`]: { vr: "US", Value: [rows * 2] },
    [`${group}0040`]: { vr: "CS", Value: ["G"] },
    [`${group}0050`]: { vr: "SS", Value: [1, 1] },
    [`${group}3000`]: { vr: "OW", BulkDataURI: uri }
});

describe("OverlaySequence", () => {
    it("naturalizes each overlay group to one item, with its own values", () => {
        const natural = DicomMetaDictionary.naturalizeDataset({
            "00100010": { vr: "PN", Value: [{ Alphabetic: "Doe^Jane" }] },
            ...overlay("6002", 32, "uri2"),
            ...overlay("6000", 16, "uri0")
        });

        expect(natural.OverlayRows).toBeUndefined();
        expect(natural.OverlaySequence.length).toBe(2);
        const [first, second] = natural.OverlaySequence;
        expect(first.group).toBe("6000");
        expect(first.OverlayRows).toBe(16);
        expect(first.OverlayOrigin).toEqual([1, 1]);
        expect(first.OverlayData).toEqual({ BulkDataURI: "uri0" });
        expect(first._vrMap.OverlayData).toBe("OW");
        expect(second.group).toBe("6002");
        expect(second.OverlayColumns).toBe(64);
    });

    it("gives one overlay as a sequence of one item", () => {
        const natural = DicomMetaDictionary.naturalizeDataset(
            overlay("6000", 16, "uri0")
        );

        expect(natural.OverlaySequence.length).toBe(1);
        expect(natural.OverlaySequence[0].OverlayRows).toBe(16);
        expect(natural.OverlaySequence.OverlayRows).toBe(16);
    });

    it("keeps an odd 60xx group as a private tag", () => {
        const natural = DicomMetaDictionary.naturalizeDataset({
            60010010: { vr: "LO", Value: ["ACME"] }
        });

        expect(natural.OverlaySequence).toBeUndefined();
        expect(natural["60010010"]).toBe("ACME");
    });

    it("denaturalizes each item to its group", () => {
        const source = {
            ...overlay("6000", 16, "uri0"),
            ...overlay("6002", 32, "uri2")
        };
        const dict = DicomMetaDictionary.denaturalizeDataset(
            DicomMetaDictionary.naturalizeDataset(source)
        );

        expect(dict["60000010"].Value).toEqual(["16"]);
        expect(dict["60020010"].Value).toEqual(["32"]);
        expect(dict["60023000"]).toEqual(
            expect.objectContaining({
                vr: "OW",
                Value: [{ BulkDataURI: "uri2" }]
            })
        );
        expect(Object.keys(dict).sort()).toEqual(Object.keys(source).sort());
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
