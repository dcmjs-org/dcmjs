import { parseVm } from "../../packages/schemas/generate/schemaRules.mjs";

describe("parseVm", () => {
    test.each([
        ["1", { min: 1, max: 1, multiple: null }],
        ["2", { min: 2, max: 2, multiple: null }],
        ["16", { min: 16, max: 16, multiple: null }],
        ["1-n", { min: 1, max: null, multiple: null }],
        ["2-n", { min: 2, max: null, multiple: null }],
        ["1-8", { min: 1, max: 8, multiple: null }],
        ["1-99", { min: 1, max: 99, multiple: null }],
        ["3-3n", { min: 3, max: null, multiple: 3 }],
        ["2-2n", { min: 2, max: null, multiple: 2 }],
        ["6-n", { min: 6, max: null, multiple: null }]
    ])("parses %s", (vm, expected) => {
        expect(parseVm(vm)).toEqual(expected);
    });

    test("throws on unclassifiable VM", () => {
        expect(() => parseVm("banana")).toThrow(/unclassifiable VM/i);
    });
});
