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
