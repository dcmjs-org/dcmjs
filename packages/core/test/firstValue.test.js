import { toStringFirst, toFloatFirst } from "../src/utilities/firstValue.js";

describe("first-value readers of naturalized values", () => {
    test.each([
        [" MR ", "MR"],
        [["CT", "MR"], "CT"],
        [12, "12"],
        ["  ", null],
        [[], null],
        [undefined, null],
        [{ Alphabetic: "Doe^Jane" }, null]
    ])("toStringFirst(%j) is %j", (value, expected) => {
        expect(toStringFirst(value)).toBe(expected);
    });

    test.each([
        ["2.5", 2.5],
        [[3, 4], 3],
        [["7"], 7],
        [7, 7],
        ["abc", null],
        [[], null],
        [null, null]
    ])("toFloatFirst(%j) is %j", (value, expected) => {
        expect(toFloatFirst(value)).toBe(expected);
    });
});
