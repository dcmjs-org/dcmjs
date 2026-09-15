import {
    parseVm,
    VR_SCALAR,
    MULTI_VR,
    VR_FORMATS,
    EXCLUDED_TAGS
} from "../../generate/schemaRules.mjs";

describe("parseVm", () => {
    test.each([
        ["1", { min: 1, max: 1, multiple: null, multi: false }],
        ["2", { min: 2, max: 2, multiple: null, multi: true }],
        ["16", { min: 16, max: 16, multiple: null, multi: true }],
        ["1-n", { min: 1, max: null, multiple: null, multi: true }],
        ["2-n", { min: 2, max: null, multiple: null, multi: true }],
        ["1-8", { min: 1, max: 8, multiple: null, multi: true }],
        ["1-99", { min: 1, max: 99, multiple: null, multi: true }],
        ["3-3n", { min: 3, max: null, multiple: 3, multi: true }],
        ["2-2n", { min: 2, max: null, multiple: 2, multi: true }],
        ["6-n", { min: 6, max: null, multiple: null, multi: true }]
    ])("parses %s", (vm, expected) => {
        expect(parseVm(vm)).toEqual(expected);
    });

    test("throws on unclassifiable VM", () => {
        expect(() => parseVm("banana")).toThrow(/unclassifiable VM/i);
    });
});

describe("VR maps", () => {
    test("scalar map covers the string/number/PN/SQ/binary split", () => {
        expect(VR_SCALAR.CS).toBe("string");
        expect(VR_SCALAR.DA).toBe("string");
        expect(VR_SCALAR.AT).toBe("string");
        expect(VR_SCALAR.DS).toBe("number");
        expect(VR_SCALAR.US).toBe("number");
        expect(VR_SCALAR.PN).toBe("PersonName");
        expect(VR_SCALAR.SQ).toBe("NaturalizedDataset[]");
        // Binary byte VRs are blobs, not numbers (decision log D9)
        for (const vr of ["OB", "OW", "OF", "OD", "OL", "OV", "UN"]) {
            expect(VR_SCALAR[vr]).toBe("BinaryValue");
        }
        // 64-bit integers may exceed Number.MAX_SAFE_INTEGER (D14)
        expect(VR_SCALAR.UV).toBe("number | string");
        expect(VR_SCALAR.SV).toBe("number | string");
    });

    test("multi-VR codes map to explicit unions", () => {
        expect(MULTI_VR.xs).toEqual(["US", "SS"]);
        expect(MULTI_VR.ox).toEqual(["OB", "OW"]);
        expect(MULTI_VR.up).toEqual(["UL"]);
        expect(MULTI_VR.lt).toEqual(["OW", "US", "SS"]);
    });

    test("VR formats encode Part 5 constraints", () => {
        expect(VR_FORMATS.DA).toEqual({ pattern: "^\\d{8}$" });
        expect(VR_FORMATS.IS).toEqual({ maxLength: 12, pattern: "^[+-]?\\d+$" });
        expect(VR_FORMATS.DS).toEqual({ maxLength: 16 });
        expect(VR_FORMATS.UI).toEqual({ maxLength: 64, pattern: "^[0-9.]+$" });
        expect(VR_FORMATS.AS).toEqual({ pattern: "^\\d{3}[DWMY]$" });
    });

    test("FFFE structural items are excluded", () => {
        expect(EXCLUDED_TAGS.has("FFFEE000")).toBe(true);
        expect(EXCLUDED_TAGS.has("FFFEE00D")).toBe(true);
        expect(EXCLUDED_TAGS.has("FFFEE0DD")).toBe(true);
    });
});
