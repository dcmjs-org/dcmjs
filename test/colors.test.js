import { Colors } from "../src/colors.js";

// Reference colors: 8 bit sRGB and the corresponding D50 CIELab (ICC PCS)
// values, shared with the DCMTK and PixelMed test suites (dcmiod/tests/tcielabutil.cc)
const referenceColors = [
    ["black", [0, 0, 0], [0.0, 0.0, 0.0]],
    ["white", [255, 255, 255], [100.0, 0.0, 0.0]],
    ["gray", [128, 128, 128], [53.585, 0.0, 0.0]],
    ["red", [255, 0, 0], [54.291, 80.805, 69.891]],
    ["lime", [0, 255, 0], [87.819, -79.271, 80.995]],
    ["blue", [0, 0, 255], [29.568, 68.287, -112.03]],
    ["yellow", [255, 255, 0], [97.607, -15.75, 93.394]],
    ["cyan", [0, 255, 255], [90.666, -50.656, -14.962]],
    ["magenta", [255, 0, 255], [60.169, 93.54, -60.501]],
    ["orange", [255, 165, 0], [75.59, 27.516, 79.121]],
    ["CSF space", [85, 188, 255], [72.318, -15.277, -42.679]],
    ["aorta", [224, 97, 76], [57.648, 49.583, 37.62]],
    ["bone", [241, 214, 145], [86.748, 2.835, 37.696]],
    ["liver", [221, 130, 101], [64.063, 33.878, 31.516]],
    ["spleen", [157, 108, 162], [52.334, 27.009, -21.229]],
    ["thyroid gland", [62, 162, 114], [59.883, -39.102, 16.066]],
    ["vein", [0, 151, 206], [57.968, -19.204, -38.353]]
];

const roundTrip8 = rgb => Colors.dicomlab2RGB8(Colors.rgb82DICOMLAB(rgb));

describe("Colors", () => {
    it("maps sRGB white onto the D50 white point", () => {
        const lab = Colors.rgb2LAB([1, 1, 1]);
        expect(lab[0]).toBeCloseTo(100, 6);
        expect(lab[1]).toBeCloseTo(0, 6);
        expect(lab[2]).toBeCloseTo(0, 6);
        const xyz = Colors.rgb2XYZ([1, 1, 1]);
        Colors.d50WhitePointXYZ().forEach((w, i) =>
            expect(xyz[i]).toBeCloseTo(w, 6)
        );
    });

    it("encodes white and black like ICC v4.3 Table 14", () => {
        expect(Colors.rgb82DICOMLAB([255, 255, 255])).toEqual([
            0xffff, 0x8080, 0x8080
        ]);
        expect(Colors.dicomlab2RGB8([0xffff, 0x8080, 0x8080])).toEqual([
            255, 255, 255
        ]);
        expect(Colors.rgb82DICOMLAB([0, 0, 0])).toEqual([0, 0x8080, 0x8080]);
        expect(Colors.dicomlab2RGB8([0, 0x8080, 0x8080])).toEqual([0, 0, 0]);
    });

    it.each(referenceColors)(
        "matches the D50 reference for %s",
        (name, rgb, expected) => {
            const lab = Colors.rgb2LAB(rgb.map(c => c / 255));
            lab.forEach((v, i) =>
                expect(Math.abs(v - expected[i])).toBeLessThan(0.03)
            );
            expect(roundTrip8(rgb)).toEqual(rgb);
        }
    );

    it("is consistent with PixelMed for specific values", () => {
        expect(Colors.dicomlab2RGB8([35732, 48892, 14692])).toEqual([
            181, 82, 255
        ]);
        expect(Colors.dicomlab2RGB8([0, 0x8000, 0x8000])).toEqual([0, 0, 1]);
        expect(Colors.dicomlab2RGB8([19378, 50557, 3680])).toEqual([0, 0, 255]);
    });

    it("clips colors outside the sRGB gamut to the valid range", () => {
        const corners = [
            [0, 0, 0],
            [65535, 65535, 65535],
            [65535, 0, 0],
            [0, 65535, 65535]
        ];
        for (const lab of corners) {
            for (const c of Colors.dicomlab2RGB(lab)) {
                expect(c).toBeGreaterThanOrEqual(0);
                expect(c).toBeLessThanOrEqual(1);
            }
        }
    });

    it("round trips 8 bit RGB exactly through 16 bit DICOM CIELab", () => {
        let mismatches = 0;
        for (let r = 0; r < 256; r += 5) {
            for (let g = 0; g < 256; g += 5) {
                for (let b = 0; b < 256; b += 5) {
                    const out = roundTrip8([r, g, b]);
                    if (out[0] !== r || out[1] !== g || out[2] !== b) {
                        mismatches++;
                    }
                }
            }
        }
        expect(mismatches).toBe(0);
    });
});
