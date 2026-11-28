import { isUnSequenceValue } from "../src/utilities/unSequence.js";

const UNDEFINED_LENGTH = 0xffffffff;

// A DataView over bytes that start with `tag` (little endian) and an item length.
function viewOf(group, element, itemLength = UNDEFINED_LENGTH) {
    const view = new DataView(new ArrayBuffer(16));
    view.setUint16(0, group, true);
    view.setUint16(2, element, true);
    view.setUint32(4, itemLength, true);
    return view;
}

describe("isUnSequenceValue", () => {
    test("a UN value of undefined length that starts with an item is a sequence", () => {
        const view = viewOf(0xfffe, 0xe000);
        expect(isUnSequenceValue(view, 0, UNDEFINED_LENGTH, "UN")).toBe(true);
        expect(isUnSequenceValue(view, 0, UNDEFINED_LENGTH, "SQ")).toBe(true);
    });

    test("a UN value of undefined length that starts with the sequence delimiter is an empty sequence", () => {
        const view = viewOf(0xfffe, 0xe0dd, 0);
        expect(isUnSequenceValue(view, 0, UNDEFINED_LENGTH, "UN")).toBe(true);
    });

    test("a UN value of undefined length that starts with another tag stays UN", () => {
        const view = viewOf(0x0028, 0x1201, 4);
        expect(isUnSequenceValue(view, 0, UNDEFINED_LENGTH, "UN")).toBe(false);
    });

    test("a value of undefined length keeps its dictionary VR when it is not UN or SQ", () => {
        // encapsulated pixel data: dictionary VR OB, the first item is the offset table
        const view = viewOf(0xfffe, 0xe000, 0);
        expect(isUnSequenceValue(view, 0, UNDEFINED_LENGTH, "OB")).toBe(false);
    });

    test("a value of undefined length with fewer than 8 bytes is not a sequence", () => {
        const view = new DataView(new ArrayBuffer(4));
        view.setUint16(0, 0xfffe, true);
        view.setUint16(2, 0xe000, true);
        expect(isUnSequenceValue(view, 0, UNDEFINED_LENGTH, "UN")).toBe(false);
    });

    test("a defined length still needs an item that fits in the value", () => {
        expect(isUnSequenceValue(viewOf(0xfffe, 0xe000, 8), 0, 16, "UN")).toBe(
            true
        );
        expect(
            isUnSequenceValue(viewOf(0xfffe, 0xe000, 100), 0, 16, "UN")
        ).toBe(false);
        expect(isUnSequenceValue(viewOf(0xfffe, 0xe0dd, 0), 0, 16, "UN")).toBe(
            false
        );
        expect(isUnSequenceValue(viewOf(0xfffe, 0xe000), 0, 4, "UN")).toBe(
            false
        );
    });
});
