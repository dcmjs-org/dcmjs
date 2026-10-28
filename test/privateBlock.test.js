import dcmjs from "../src/index.js";
import { EXPLICIT_LITTLE_ENDIAN } from "../src/constants/dicom.js";

const { DicomDict, DicomMessage, findPrivateBlock, privateTag } = dcmjs.data;

const META = {
    "00020010": { vr: "UI", Value: [EXPLICIT_LITTLE_ENDIAN] },
    "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
    "00020003": { vr: "UI", Value: ["1.2.3"] }
};

const newDict = () => {
    const dicomDict = new DicomDict(META);
    dicomDict.dict = {};
    dicomDict.upsertTag("00080060", "CS", ["OT"]);
    dicomDict.upsertTag("00080016", "UI", ["1.2.840.10008.5.1.4.1.1.7"]);
    dicomDict.upsertTag("00080018", "UI", ["1.2.3"]);
    return dicomDict;
};

describe("private block reservation (PS3.5 Section 7.8.1)", () => {
    it("reserves the first free block and maps elements into it", () => {
        const dicomDict = newDict();
        const block = dicomDict.privateBlock(0x4d43, "ACME 1.0");

        // creator at (4D43,0010) reserves (4D43,1000) ... (4D43,10FF)
        expect(block.block).toEqual(0x10);
        expect(dicomDict.dict["4D430010"].Value).toEqual(["ACME 1.0"]);
        expect(dicomDict.dict["4D430010"].vr).toEqual("LO");
        expect(block.tag(0x01)).toEqual("4D431001");
        expect(block.tag(0xff)).toEqual("4D4310FF");

        block.set(0x01, "CS", ["HYBRID"]);
        expect(dicomDict.dict["4D431001"].Value).toEqual(["HYBRID"]);
        expect(block.get(0x01).vr).toEqual("CS");
        expect(block.has(0x01)).toBe(true);
        expect(block.has(0x02)).toBe(false);
    });

    it("returns the same block for the same creator, and the next for another", () => {
        const dicomDict = newDict();
        const first = dicomDict.privateBlock(0x4d43, "ACME 1.0");
        const again = dicomDict.privateBlock(0x4d43, "ACME 1.0");
        const other = dicomDict.privateBlock(0x4d43, "OTHER 1.0");

        expect(again.block).toEqual(first.block);
        expect(other.block).toEqual(0x11);
        expect(other.tag(0x01)).toEqual("4D431101");
        expect(dicomDict.dict["4D430011"].Value).toEqual(["OTHER 1.0"]);
    });

    it("skips a block someone else already reserved", () => {
        const dicomDict = newDict();
        // a file written elsewhere already holds 0x10 and 0x11
        dicomDict.upsertTag("4D430010", "LO", ["SOMEONE ELSE"]);
        dicomDict.upsertTag("4D430011", "LO", ["ANOTHER"]);

        const block = dicomDict.privateBlock(0x4d43, "ACME 1.0");
        expect(block.block).toEqual(0x12);
        expect(dicomDict.dict["4D430010"].Value).toEqual(["SOMEONE ELSE"]);
    });

    it("finds a block without reserving one when asked not to create", () => {
        const dicomDict = newDict();
        expect(
            dicomDict.privateBlock(0x4d43, "ACME 1.0", { create: false })
        ).toBeNull();
        expect(dicomDict.dict["4D430010"]).toBeUndefined();

        dicomDict.privateBlock(0x4d43, "ACME 1.0");
        expect(
            dicomDict.privateBlock(0x4d43, "ACME 1.0", { create: false }).block
        ).toEqual(0x10);
    });

    it("round trips through a file, and is found by creator not by block", () => {
        const dicomDict = newDict();
        const block = dicomDict.privateBlock(0x4d43, "ACME 1.0");
        block.set(0x01, "CS", ["HYBRID"]);
        block.set(0x02, "UL", [1234]);

        const dict = DicomMessage.readFile(dicomDict.write()).dict;

        // the reader does not assume 0x10 - it looks the creator up
        const found = findPrivateBlock(dict, 0x4d43, "ACME 1.0");
        expect(found).not.toBeNull();
        expect(found.block).toEqual(0x10);
        expect(found.get(0x01).Value).toEqual(["HYBRID"]);
        expect(found.get(0x02).Value).toEqual([1234]);

        expect(findPrivateBlock(dict, 0x4d43, "NOT PRESENT")).toBeNull();
    });

    it("finds the creator wherever it landed", () => {
        const dicomDict = newDict();
        // push the creator to a high block, as a real file might
        for (let block = 0x10; block < 0x30; block++) {
            dicomDict.upsertTag(
                "4D43" + block.toString(16).toUpperCase().padStart(4, "0"),
                "LO",
                ["FILLER " + block]
            );
        }
        const block = dicomDict.privateBlock(0x4d43, "ACME 1.0");
        expect(block.block).toEqual(0x30);

        const dict = DicomMessage.readFile(dicomDict.write()).dict;
        expect(findPrivateBlock(dict, 0x4d43, "ACME 1.0").block).toEqual(0x30);
    });

    it("tolerates a creator value padded to an even length", () => {
        const dicomDict = newDict();
        // LO pads with a space, so a creator read back can have a trailing one
        dicomDict.upsertTag("4D430010", "LO", ["ACME 1.0 "]);
        expect(
            findPrivateBlock(dicomDict.dict, 0x4d43, "ACME 1.0").block
        ).toEqual(0x10);
    });

    it("carries a binary payload, and pads an odd length to even", () => {
        // The reason to reserve a block at all is usually to put something in
        // it. DICOM value fields are even length (PS3.5 Section 7.1.1), so an
        // odd length OB comes back one byte longer, with a trailing pad - which
        // is why a payload needs its own length recorded alongside it rather
        // than relying on the element length.
        const odd = new Uint8Array([1, 2, 3, 4, 5]);
        const even = new Uint8Array([9, 8, 7, 6]);

        const dicomDict = newDict();
        const block = dicomDict.privateBlock(0x4d43, "ACME 1.0");
        block.set(0x10, "UL", [odd.length]);
        block.set(0x11, "OB", [odd.buffer]);
        block.set(0x12, "OB", [even.buffer]);

        const dict = DicomMessage.readFile(dicomDict.write()).dict;
        const found = findPrivateBlock(dict, 0x4d43, "ACME 1.0");

        const readOdd = new Uint8Array(found.get(0x11).Value[0]);
        const readEven = new Uint8Array(found.get(0x12).Value[0]);

        expect(readEven).toEqual(even);
        expect(readOdd.length).toEqual(6); // 5 bytes plus the pad
        expect(found.get(0x10).Value).toEqual([5]); // the recorded length
        expect(readOdd.slice(0, found.get(0x10).Value[0])).toEqual(odd);
        expect(readOdd[5]).toEqual(0);
    });

    it("carries a payload far larger than a single value field is usually asked to hold", () => {
        // A private block is a normal home for a large opaque payload, so the
        // 32 bit length path gets exercised rather than assumed.
        const payload = new Uint8Array(512 * 1024);
        for (let i = 0; i < payload.length; i++) {
            payload[i] = (i * 31 + 7) & 0xff;
        }

        const dicomDict = newDict();
        const block = dicomDict.privateBlock(0x4d43, "ACME 1.0");
        block.set(0x20, "OB", [payload.buffer]);

        const dict = DicomMessage.readFile(dicomDict.write()).dict;
        const read = new Uint8Array(
            findPrivateBlock(dict, 0x4d43, "ACME 1.0").get(0x20).Value[0]
        );

        expect(read.length).toEqual(payload.length);
        expect(read).toEqual(payload);
    });

    it("rejects an even group, a bad block and a bad element", () => {
        const dicomDict = newDict();
        // PS3.5 Section 7.8.1: private data elements live in odd groups
        expect(() => dicomDict.privateBlock(0x4d42, "ACME 1.0")).toThrow(
            /must be odd/
        );
        // 0x00 to 0x0F are reserved, not available as blocks
        expect(() => privateTag(0x4d43, 0x0f, 0x01)).toThrow(/0x10 to 0xFF/);
        expect(() => privateTag(0x4d43, 0x100, 0x01)).toThrow(/0x10 to 0xFF/);
        expect(() => privateTag(0x4d43, 0x10, 0x100)).toThrow(/0x00 to 0xFF/);
    });

    it("rejects a creator that is empty or too long for LO", () => {
        const dicomDict = newDict();
        expect(() => dicomDict.privateBlock(0x4d43, "")).toThrow(
            /non-empty string/
        );
        expect(() => dicomDict.privateBlock(0x4d43, "x".repeat(65))).toThrow(
            /at most 64/
        );
        expect(() =>
            dicomDict.privateBlock(0x4d43, "x".repeat(64))
        ).not.toThrow();
    });

    it("throws when every block in the group is taken", () => {
        const dicomDict = newDict();
        for (let block = 0x10; block <= 0xff; block++) {
            dicomDict.upsertTag(
                "4D43" + block.toString(16).toUpperCase().padStart(4, "0"),
                "LO",
                ["TAKEN " + block]
            );
        }
        expect(() => dicomDict.privateBlock(0x4d43, "ACME 1.0")).toThrow(
            /No free private block/
        );
    });
});
