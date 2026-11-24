/**
 * The OV (Other 64-bit Very Long) and SV (Signed 64-bit Very Long) VRs, PS3.5
 * Section 6.2, Table 6.2-1. Before, both fell back to UN, so an element could
 * not be written with its own VR.
 */
import dcmjs from "../../src/index.js";
import { EXPLICIT_LITTLE_ENDIAN } from "../../src/constants/dicom.js";

const { DicomDict, DicomMessage } = dcmjs.data;

// Selector OV Value (0072,0081) and Selector SV Value (0072,0082)
const SELECTOR_OV_VALUE = "00720081";
const SELECTOR_SV_VALUE = "00720082";

function writeThenRead(tag, vr, value) {
    const dicomDict = new DicomDict({
        "00020010": { vr: "UI", Value: [EXPLICIT_LITTLE_ENDIAN] }
    });
    dicomDict.dict = {};
    dicomDict.upsertTag(tag, vr, value);
    const bytes = new Uint8Array(dicomDict.write());
    // the VR on the wire follows the last 4 tag bytes (group, element LE)
    const tagBytes = [1, 0, 3, 2].map(i =>
        parseInt(tag.slice(i * 2, i * 2 + 2), 16)
    );
    const at = bytes.findIndex((_, i) =>
        tagBytes.every((b, j) => bytes[i + j] === b)
    );
    return {
        wireVr: String.fromCharCode(bytes[at + 4], bytes[at + 5]),
        element: DicomMessage.readFile(bytes.buffer).dict[tag]
    };
}

describe("OV and SV value representations", () => {
    it("round trips OV as 64 bit words of raw bytes", () => {
        const words = BigUint64Array.of(1n, 0xffffffffffffffffn);
        const { wireVr, element } = writeThenRead(SELECTOR_OV_VALUE, "OV", [
            words.buffer
        ]);

        expect(wireVr).toBe("OV");
        expect(element.vr).toBe("OV");
        expect(Array.from(new BigUint64Array(element.Value[0]))).toEqual([
            1n,
            0xffffffffffffffffn
        ]);
    });

    it("round trips SV as signed BigInt values, and writes a Number", () => {
        const { wireVr, element } = writeThenRead(SELECTOR_SV_VALUE, "SV", [
            -1n,
            -0x8000000000000000n,
            0x7fffffffffffffffn,
            -5
        ]);

        expect(wireVr).toBe("SV");
        expect(element.vr).toBe("SV");
        expect(element.Value).toEqual([
            -1n,
            -0x8000000000000000n,
            0x7fffffffffffffffn,
            -5n
        ]);
    });
});
