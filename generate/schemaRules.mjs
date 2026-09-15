// Rule primitives for the D22 naturalized schema generator.
// Spec: docs/superpowers/specs/2026-07-03-d22-naturalized-schema-design.md

// VM pattern -> {min, max, multiple, multi}. max null = unbounded.
// multi = the naturalized container is an array (VM other than exactly "1").
export function parseVm(vm) {
    let m;
    if ((m = vm.match(/^(\d+)$/))) {
        const n = Number(m[1]);
        return { min: n, max: n, multiple: null, multi: n !== 1 };
    }
    if ((m = vm.match(/^(\d+)-n$/))) {
        return { min: Number(m[1]), max: null, multiple: null, multi: true };
    }
    if ((m = vm.match(/^(\d+)-(\d+)$/))) {
        return {
            min: Number(m[1]),
            max: Number(m[2]),
            multiple: null,
            multi: true
        };
    }
    if ((m = vm.match(/^(\d+)-(\d+)n$/))) {
        // e.g. 3-3n: at least 3, count must be a multiple of 3
        return {
            min: Number(m[1]),
            max: null,
            multiple: Number(m[2]),
            multi: true
        };
    }
    throw new Error(`unclassifiable VM pattern: "${vm}"`);
}

const STRING_VRS = "AE AS AT CS DA DT LO LT SH ST TM UC UI UR UT".split(" ");
const NUMBER_VRS = "DS FL FD IS SL SS UL US".split(" ");
const BINARY_VRS = "OB OD OF OL OV OW UN".split(" ");

export const VR_SCALAR = Object.fromEntries([
    ...STRING_VRS.map(vr => [vr, "string"]),
    ...NUMBER_VRS.map(vr => [vr, "number"]),
    ...BINARY_VRS.map(vr => [vr, "BinaryValue"]),
    ["PN", "PersonName"],
    ["SQ", "NaturalizedDataset[]"],
    // 64-bit: out-of-safe-range integers retain string form (D14 / spec §12.4)
    ["UV", "number | string"],
    ["SV", "number | string"]
]);

// Ambiguous dictionary VR codes -> explicit member unions (exhaustive for
// the packed dictionary; the generator fails loudly on anything else).
export const MULTI_VR = {
    xs: ["US", "SS"],
    ox: ["OB", "OW"],
    up: ["UL"],
    lt: ["OW", "US", "SS"]
};

// Part 5 per-VR value-format constraints (VR-format depth, D27 decision 3).
export const VR_FORMATS = {
    AE: { maxLength: 16 },
    AS: { pattern: "^\\d{3}[DWMY]$" },
    CS: { maxLength: 16, pattern: "^[A-Z0-9 _]*$" },
    DA: { pattern: "^\\d{8}$" },
    DS: { maxLength: 16 },
    DT: {
        maxLength: 26,
        pattern:
            "^\\d{4}(\\d{2}(\\d{2}(\\d{2}(\\d{2}(\\d{2}(\\.\\d{1,6})?)?)?)?)?)?([+-]\\d{4})?$"
    },
    IS: { maxLength: 12, pattern: "^[+-]?\\d+$" },
    LO: { maxLength: 64 },
    LT: { maxLength: 10240 },
    SH: { maxLength: 16 },
    ST: { maxLength: 1024 },
    TM: { pattern: "^\\d{2}(\\d{2}(\\d{2}(\\.\\d{1,6})?)?)?$" },
    UI: { maxLength: 64, pattern: "^[0-9.]+$" }
};

// Group FFFE items are stream structure, not data elements (VR "na").
export const EXCLUDED_TAGS = new Set(["FFFEE000", "FFFEE00D", "FFFEE0DD"]);
