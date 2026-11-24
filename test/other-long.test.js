import dcmjs from "../src/index.js";
import { EXPLICIT_LITTLE_ENDIAN } from "../src/constants/dicom.js";

const { DicomDict, DicomMessage, ValueRepresentation } = dcmjs.data;

// (0066,0041) Long Triangle Point Index List, the attribute that needs OL: the 16 bit indices of
// Triangle Point Index List (0066,0023), which is OW, cap a surface at 65535 points.
const LONG_TRIANGLE_POINT_INDEX_LIST = "00660041";
const SURFACE_SEGMENTATION_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.66.5";

const META = {
    "00020010": { vr: "UI", Value: [EXPLICIT_LITTLE_ENDIAN] },
    "00020002": { vr: "UI", Value: [SURFACE_SEGMENTATION_SOP_CLASS] },
    "00020003": { vr: "UI", Value: ["1.2.3"] }
};

/** uint32 indices as bytes, little endian. */
function indices(count) {
    const words = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
        // values above 65535, which is the whole point of OL
        words[i] = 70000 + i * 3;
    }
    return words;
}

function writeThenRead(buffer, vr = "OL") {
    const dicomDict = new DicomDict(META);
    dicomDict.dict = {};
    dicomDict.upsertTag("00080016", "UI", [SURFACE_SEGMENTATION_SOP_CLASS]);
    dicomDict.upsertTag("00080018", "UI", ["1.2.3"]);
    dicomDict.upsertTag(LONG_TRIANGLE_POINT_INDEX_LIST, vr, [buffer]);
    const written = dicomDict.write();
    return { written, read: DicomMessage.readFile(written) };
}

describe("OL (Other Long) value representation", () => {
    it("is a known VR rather than falling back to UN", () => {
        const vr = ValueRepresentation.createByTypeString("OL");
        expect(vr.type).toEqual("OL");
        // 32 bit length, like the other Other* VRs, not a 16 bit one
        expect(vr.isLength32()).toBe(true);
        // a single value, not a multiplicity
        expect(vr.allowMultiple()).toBe(false);
    });

    it("round trips 32 bit words whose values exceed what OW could hold", () => {
        const words = indices(1000);
        const { read } = writeThenRead(words.buffer);

        const element = read.dict[LONG_TRIANGLE_POINT_INDEX_LIST];
        expect(element.vr).toEqual("OL");

        const back = new Uint32Array(element.Value[0]);
        expect(back.length).toEqual(words.length);
        expect(Array.from(back)).toEqual(Array.from(words));
        // and the values really are outside OW's range, so this could not have been OW
        expect(back[0]).toBeGreaterThan(0xffff);
    });

    it("writes OL as the VR on the wire, with a 32 bit length", () => {
        const words = indices(4);
        const { written } = writeThenRead(words.buffer);
        const bytes = new Uint8Array(written);

        // find the element: tag (0066,0041) little endian is 66 00 41 00
        let at = -1;
        for (let i = 132; i < bytes.length - 4; i++) {
            if (
                bytes[i] === 0x66 &&
                bytes[i + 1] === 0x00 &&
                bytes[i + 2] === 0x41 &&
                bytes[i + 3] === 0x00
            ) {
                at = i;
                break;
            }
        }
        expect(at).toBeGreaterThan(0);

        // VR follows the tag, as two ASCII characters
        expect(String.fromCharCode(bytes[at + 4], bytes[at + 5])).toEqual("OL");
        // then two reserved bytes, then a 32 bit length - the length32 form
        expect(bytes[at + 6]).toEqual(0);
        expect(bytes[at + 7]).toEqual(0);
        const length =
            bytes[at + 8] |
            (bytes[at + 9] << 8) |
            (bytes[at + 10] << 16) |
            (bytes[at + 11] << 24);
        expect(length).toEqual(words.byteLength);
    });

    it("carries a surface far larger than OW's 65535 point limit", () => {
        // 200000 triangles is 600000 indices: 2.4 MB, and every index needs 32 bits
        const words = indices(600000);
        const { read } = writeThenRead(words.buffer);
        const back = new Uint32Array(
            read.dict[LONG_TRIANGLE_POINT_INDEX_LIST].Value[0]
        );
        expect(back.length).toEqual(600000);
        expect(back[599999]).toEqual(70000 + 599999 * 3);
    });

    it("round trips an empty value", () => {
        const { read } = writeThenRead(new Uint32Array(0).buffer);
        const element = read.dict[LONG_TRIANGLE_POINT_INDEX_LIST];
        expect(element.vr).toEqual("OL");
        expect(new Uint32Array(element.Value[0]).length).toEqual(0);
    });

    it("can be written by keyword via _vrMap, despite the stale dictionary entry", () => {
        // The dictionary that ships with dcmjs still lists (0066,0041) as UL with VM 3-3n, which is
        // the definition CP-1365 left behind and CP-1499 corrected to OL. Until the generated
        // dictionary catches up, a caller writing by KEYWORD has to say which VR it means - which
        // _vrMap already supports. Writing by tag with upsertTag(tag, "OL", ...) is unaffected.
        const { DicomMetaDictionary } = dcmjs.data;
        expect(
            DicomMetaDictionary.nameMap["LongTrianglePointIndexList"].vr
        ).toEqual("UL");

        const words = new Uint32Array([70000, 70001, 70002]);
        const denaturalized = DicomMetaDictionary.denaturalizeDataset({
            LongTrianglePointIndexList: [words.buffer],
            _vrMap: { LongTrianglePointIndexList: "OL" }
        });

        expect(denaturalized[LONG_TRIANGLE_POINT_INDEX_LIST].vr).toEqual("OL");
        expect(
            Array.from(
                new Uint32Array(
                    denaturalized[LONG_TRIANGLE_POINT_INDEX_LIST].Value[0]
                )
            )
        ).toEqual([70000, 70001, 70002]);
    });

    it("re-encodes losslessly", () => {
        const words = indices(100);
        const { written } = writeThenRead(words.buffer);
        const rewritten = DicomMessage.readFile(written).write();
        expect(new Uint8Array(rewritten)).toEqual(new Uint8Array(written));
    });
});
