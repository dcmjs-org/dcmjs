import { lookupTagHex } from "./dicom.lookup.js";

const cache = new Map();

function _toHex8FromParenKey(k) {
    // '(0008,0005)' -> '00080005'
    return k.slice(1, 5) + k.slice(6, 10);
}

export const dictionary = new Proxy(Object.create(null), {
    get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        if (cache.has(prop)) return cache.get(prop);

        // Accept '(GGGG,EEEE)'
        if (
            prop.length === 11 &&
            prop[0] === "(" &&
            prop[5] === "," &&
            prop[10] === ")"
        ) {
            const v = lookupTagHex(_toHex8FromParenKey(prop));
            if (!v) return undefined;
            const entry = { tag: prop, ...v, version: "DICOM" };
            cache.set(prop, entry);
            return entry;
        }

        // Optional: accept raw 'GGGGEEEE'
        if (prop.length === 8) {
            const v = lookupTagHex(prop);
            if (!v) return undefined;
            const tag = "(" + prop.slice(0, 4) + "," + prop.slice(4, 8) + ")";
            const entry = { tag, ...v, version: "DICOM" };
            cache.set(prop, entry);
            return entry;
        }

        return undefined;
    },
    has(_t, prop) {
        if (typeof prop !== "string") return false;
        if (
            prop.length === 11 &&
            prop[0] === "(" &&
            prop[5] === "," &&
            prop[10] === ")"
        ) {
            return lookupTagHex(_toHex8FromParenKey(prop)) !== undefined;
        }
        if (prop.length === 8) return lookupTagHex(prop) !== undefined;
        return false;
    }
});
