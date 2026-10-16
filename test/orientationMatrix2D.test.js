import ndarray from "ndarray";
import { flipMatrix2D } from "../src/utilities/orientation/flipMatrix2D.js";
import rotateMatrix902D from "../src/utilities/orientation/rotateMatrix902D.js";

describe("orientation matrix transforms", () => {
    it("flipMatrix2D.h preserves 16-bit label values", () => {
        const matrix = ndarray(Uint16Array.from([300, 513]), [1, 2]);

        const flipped = flipMatrix2D.h(matrix);

        expect(flipped.data.constructor).toBe(Uint16Array);
        expect(Array.from(flipped.data)).toEqual([513, 300]);
    });

    it("flipMatrix2D.v preserves 16-bit label values", () => {
        const matrix = ndarray(Uint16Array.from([300, 513]), [2, 1]);

        const flipped = flipMatrix2D.v(matrix);

        expect(flipped.data.constructor).toBe(Uint16Array);
        expect(Array.from(flipped.data)).toEqual([513, 300]);
    });

    it("rotateMatrix902D preserves 16-bit label values", () => {
        const matrix = ndarray(Uint16Array.from([300, 513]), [1, 2]);

        const rotated = rotateMatrix902D(matrix);

        expect(rotated.data.constructor).toBe(Uint16Array);
        expect(Array.from(rotated.data)).toEqual([300, 513]);
    });

    it("keeps Uint8Array results for Uint8Array input", () => {
        const matrix = ndarray(Uint8Array.from([3, 1]), [1, 2]);

        expect(flipMatrix2D.h(matrix).data.constructor).toBe(Uint8Array);
        expect(
            flipMatrix2D.v(ndarray(Uint8Array.from([3, 1]), [2, 1])).data
                .constructor
        ).toBe(Uint8Array);
        expect(rotateMatrix902D(matrix).data.constructor).toBe(Uint8Array);
    });
});
