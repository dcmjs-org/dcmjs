/**
 * Binary values in the naturalized form (NAT-U-BIN in
 * docs/specs/naturalized-dataset.md): both producers give a list of
 * ArrayBuffer, or of Uint8Array with `binaryAs: "Uint8Array"`.
 */
import dcmjs from "../../src/index.js";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { fromDataSet } from "../../src/eventStream/fromDataSet";

const { DicomMetaDictionary } = dcmjs.data;

// A view into a larger buffer, as a reader that does not copy can give.
const bytes = new Uint8Array([9, 9, 1, 2, 3, 4, 9, 9]);
const sourceDict = () => ({
    "7FE00010": { vr: "OB", Value: [bytes.subarray(2, 6)] }
});

async function bothProducers(options) {
    const listener = new NaturalizedListener(options);
    await fromDataSet({ dict: sourceDict() }, listener);
    return [
        DicomMetaDictionary.naturalizeDataset(sourceDict(), options),
        listener.result
    ];
}

describe("binary values", () => {
    it("both producers give a list of ArrayBuffer with only the value bytes", async () => {
        for (const naturalized of await bothProducers()) {
            const [fragment] = naturalized.PixelData;
            expect(fragment).toBeInstanceOf(ArrayBuffer);
            expect(Array.from(new Uint8Array(fragment))).toEqual([1, 2, 3, 4]);
        }
    });

    it("a binary element with no value is null in both producers", async () => {
        const emptyDict = () => ({
            "00420011": { vr: "OB" }, // EncapsulatedDocument, no Value
            "7FE00010": { vr: "OB", Value: [] },
            "00291001": { vr: "UN" }, // private, no creator
            // a Part 10 reader gives one empty fragment for an empty element
            "00281201": { vr: "OW", Value: [new ArrayBuffer(0)] }
        });
        const listener = new NaturalizedListener();
        await fromDataSet({ dict: emptyDict() }, listener);
        for (const naturalized of [
            DicomMetaDictionary.naturalizeDataset(emptyDict()),
            listener.result
        ]) {
            expect(naturalized.EncapsulatedDocument).toBeNull();
            expect(naturalized.PixelData).toBeNull();
            expect(naturalized["00291001"]).toBeNull();
            expect(naturalized.RedPaletteColorLookupTableData).toBeNull();
        }
    });

    it('binaryAs: "Uint8Array" gives views over the source bytes, not copies', async () => {
        for (const naturalized of await bothProducers({
            binaryAs: "Uint8Array"
        })) {
            const [fragment] = naturalized.PixelData;
            expect(fragment).toBeInstanceOf(Uint8Array);
            expect(fragment.buffer).toBe(bytes.buffer);
            expect(Array.from(fragment)).toEqual([1, 2, 3, 4]);
        }
    });
});
