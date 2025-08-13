import { deepEqual } from "../../src/utilities/deepEqual";

describe("deepEqual", () => {
    test("returns true for identical primitives", () => {
        expect(deepEqual(42, 42)).toBe(true);
        expect(deepEqual("hello", "hello")).toBe(true);
        expect(deepEqual(true, true)).toBe(true);
        expect(deepEqual(null, null)).toBe(true);
    });

    test("returns false for different primitives", () => {
        expect(deepEqual(42, 43)).toBe(false);
        expect(deepEqual("hello", "world")).toBe(false);
        expect(deepEqual(true, false)).toBe(false);
        expect(deepEqual(null, undefined)).toBe(false);
    });

    test("returns same value check for signed zeros and special numbers", () => {
        expect(deepEqual(Math.NaN, Math.NaN)).toBe(true);
        expect(deepEqual(-0, 0)).toBe(false);
        expect(deepEqual(-0, +0)).toBe(false);
    });

    test("returns true for deeply equal objects", () => {
        const obj1 = { a: 1, b: { c: 2 } };
        const obj2 = { a: 1, b: { c: 2 } };
        expect(deepEqual(obj1, obj2)).toBe(true);
    });

    test("returns false for objects with different structures", () => {
        const obj1 = { a: 1, b: { c: 2 } };
        const obj2 = { a: 1, b: { d: 2 } };
        expect(deepEqual(obj1, obj2)).toBe(false);
    });

    test("returns false for objects with different values", () => {
        const obj1 = { a: 1, b: { c: 2 } };
        const obj2 = { a: 1, b: { c: 3 } };
        expect(deepEqual(obj1, obj2)).toBe(false);
    });

    test("returns true for deeply equal arrays", () => {
        const arr1 = [1, 2, { a: 3 }];
        const arr2 = [1, 2, { a: 3 }];
        expect(deepEqual(arr1, arr2)).toBe(true);
    });

    test("returns false for arrays with different values", () => {
        const arr1 = [1, 2, { a: 3 }];
        const arr2 = [1, 2, { a: 4 }];
        expect(deepEqual(arr1, arr2)).toBe(false);
    });

    test("returns false for objects compared with arrays", () => {
        const obj = { a: 1, b: 2 };
        const arr = [1, 2];
        expect(deepEqual(obj, arr)).toBe(false);
    });

    test("returns false for different object types", () => {
        const date1 = new Date(2024, 0, 1);
        const obj1 = { a: 1, b: 2 };
        expect(deepEqual(date1, obj1)).toBe(false);
    });

    test("returns true for nested objects with arrays", () => {
        const obj1 = { a: 1, b: [1, 2, { c: 3 }] };
        const obj2 = { a: 1, b: [1, 2, { c: 3 }] };
        expect(deepEqual(obj1, obj2)).toBe(true);
    });

    test("returns false for functions, as they should not be equal", () => {
        const obj1 = {
            a: 1,
            b: function () {
                return 2;
            }
        };
        const obj2 = {
            a: 1,
            b: function () {
                return 2;
            }
        };
        expect(deepEqual(obj1, obj2)).toBe(false);
    });
});
