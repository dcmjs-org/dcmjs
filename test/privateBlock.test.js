import dcmjs from "../src/index.js";

// This file is the same on master (0.x) and 1.0-beta: the block key
// "gggg:creator" and the element key "xEE" name a private block at the dict
// level as they do in the 1.0 naturalized form.
const { DicomDict, DicomMessage, findPrivateBlock, privateBlockKey } =
    dcmjs.data;

const META = {
    "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] },
    "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
    "00020003": { vr: "UI", Value: ["1.2.3"] }
};

const newDict = () => {
    const dicomDict = new DicomDict(META);
    dicomDict.upsertTag("00080060", "CS", ["OT"]);
    dicomDict.upsertTag("00080016", "UI", ["1.2.840.10008.5.1.4.1.1.7"]);
    dicomDict.upsertTag("00080018", "UI", ["1.2.3"]);
    return dicomDict;
};

const roundTrip = dicomDict => DicomMessage.readFile(dicomDict.write()).dict;

describe("private block reservation (PS3.5 Section 7.8.1)", () => {
    it("reserves the first free block, named by block key or by group and creator", () => {
        const dicomDict = newDict();
        const block = dicomDict.privateBlock("4D43:ACME 1.0");

        expect(block.key).toBe("4D43:ACME 1.0");
        expect(block.group).toBe(0x4d43);
        expect(block.creator).toBe("ACME 1.0");
        expect(block.reservedBlock).toBe(0x10);
        expect(dicomDict.dict["4D430010"].vr).toBe("LO");
        expect(dicomDict.dict["4D430010"].Value).toEqual(["ACME 1.0"]);

        // "x01" and 0x01 are the same element
        expect(block.set("x01", "CS", ["HYBRID"])).toBe("4D431001");
        expect(block.get(0x01).Value).toEqual(["HYBRID"]);
        expect(block.has("x01")).toBe(true);
        expect(block.has("x02")).toBe(false);
        expect(block.tag("xFF")).toBe("4D4310FF");

        const same = dicomDict.privateBlock(0x4d43, "ACME 1.0");
        expect(same.reservedBlock).toBe(0x10);
        expect(privateBlockKey(0x4d43, "ACME 1.0")).toBe(block.key);
        expect(dicomDict.privateBlock("4D43:OTHER").reservedBlock).toBe(0x11);
    });

    it("skips a block that another creator or a stray element holds", () => {
        const dicomDict = newDict();
        dicomDict.upsertTag("4D430010", "LO", ["SOMEONE ELSE"]);
        dicomDict.upsertTag("4D430011", "LO", [""]);
        // an element of block 0x12 with no creator
        dicomDict.upsertTag("4D431201", "LO", ["stray"]);

        const block = dicomDict.privateBlock("4D43:ACME 1.0");
        expect(block.reservedBlock).toBe(0x13);
        expect(dicomDict.dict["4D430010"].Value).toEqual(["SOMEONE ELSE"]);
    });

    it("looks a block up without reserving one", () => {
        const dicomDict = newDict();
        expect(
            dicomDict.privateBlock("4D43:ACME 1.0", { create: false })
        ).toBeNull();
        expect(dicomDict.dict["4D430010"]).toBeUndefined();
    });

    it("round trips through a file, and is found by creator wherever it landed", () => {
        const dicomDict = newDict();
        for (let xx = 0x10; xx < 0x30; xx++) {
            dicomDict.upsertTag(
                `4D4300${xx.toString(16).toUpperCase()}`,
                "LO",
                [`FILLER ${xx}`]
            );
        }
        const block = dicomDict.privateBlock("4D43:ACME 1.0");
        block.set("x01", "CS", ["HYBRID"]);
        block.set("x02", "UL", [1234]);

        const dict = roundTrip(dicomDict);
        const found = findPrivateBlock(dict, "4D43:ACME 1.0");
        expect(found.reservedBlock).toBe(0x30);
        expect(found.get("x01").Value).toEqual(["HYBRID"]);
        expect(found.get("x02").Value).toEqual([1234]);
        expect(findPrivateBlock(dict, "4D43:NOT PRESENT")).toBeNull();
    });

    it("matches a creator padded with spaces or NULs, or held as bytes", () => {
        const dict = {
            "4D430010": { vr: "LO", Value: [" ACME 1.0 "] },
            "4D430011": { vr: "LO", Value: ["OTHER\0"] },
            "4D430012": {
                vr: "UN",
                Value: [new TextEncoder().encode("BYTES 1.0 ").buffer]
            }
        };
        expect(findPrivateBlock(dict, "4D43:ACME 1.0").reservedBlock).toBe(
            0x10
        );
        expect(findPrivateBlock(dict, 0x4d43, "OTHER").reservedBlock).toBe(
            0x11
        );
        expect(findPrivateBlock(dict, "4D43:BYTES 1.0").reservedBlock).toBe(
            0x12
        );
    });

    it("writes a line break of the creator as the text \\n in the block key", () => {
        const dicomDict = newDict();
        const block = dicomDict.privateBlock(0x4d43, "AC\r\nME");
        expect(block.key).toBe("4D43:AC\\r\\nME");
        expect(block.creator).toBe("AC\r\nME");
        block.set("x01", "LO", ["kept"]);

        const dict = roundTrip(dicomDict);
        expect(dict["4D430010"].Value).toEqual(["AC\r\nME"]);
        expect(
            findPrivateBlock(dict, "4D43:AC\\r\\nME").get("x01").Value
        ).toEqual(["kept"]);
        expect(privateBlockKey(0x4d43, "ACME\n")).toBe("4D43:ACME\\n");
    });

    it("rejects an even group, a bad block key or element, and a bad creator", () => {
        const dicomDict = newDict();
        expect(() => dicomDict.privateBlock("4D42:ACME")).toThrow(
            /must be odd/
        );
        expect(() => dicomDict.privateBlock("ACME")).toThrow(/gggg:creator/);
        expect(() => dicomDict.privateBlock(0x4d43, "")).toThrow(/non-empty/);
        expect(() => dicomDict.privateBlock(0x4d43, "x".repeat(65))).toThrow(
            /at most 64/
        );
        const block = dicomDict.privateBlock(0x4d43, "x".repeat(64));
        expect(() => block.tag(0x100)).toThrow(/0x00 to 0xFF/);
        expect(() => block.tag("x1")).toThrow(/0x00 to 0xFF/);
    });

    it("throws when every block in the group is taken", () => {
        const dicomDict = newDict();
        for (let xx = 0x10; xx <= 0xff; xx++) {
            dicomDict.upsertTag(
                `4D4300${xx.toString(16).toUpperCase()}`,
                "LO",
                [`TAKEN ${xx}`]
            );
        }
        expect(() => dicomDict.privateBlock("4D43:ACME 1.0")).toThrow(
            /No free private block/
        );
    });
});
