import { lookupTagHex, lookupTagRangeHex } from "./dicom.lookup.js";
import * as privateModule from "./dictionary.private.data.js";

const cache = new Map();

function isPrivateTagKey(prop) {
    return (
        typeof prop === "string" && prop.length > 11 && prop.indexOf('"') !== -1
    );
}

function _toHex8FromParenKey(k) {
    // '(0008,0005)' -> '00080005'
    return k.slice(1, 5) + k.slice(6, 10);
}

export const dictionary = new Proxy(Object.create(null), {
    get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        if (Object.prototype.hasOwnProperty.call(_t, prop)) return _t[prop];
        if (cache.has(prop)) return cache.get(prop);

        // Accept '(GGGG,EEEE)'
        if (
            prop.length === 11 &&
            prop[0] === "(" &&
            prop[5] === "," &&
            prop[10] === ")"
        ) {
            const hex8 = _toHex8FromParenKey(prop);
            const v = lookupTagHex(hex8) || lookupTagRangeHex(hex8);
            const entry = { tag: prop, ...v, version: "DICOM" };
            cache.set(prop, entry);
            return entry;
        }

        // Optional: accept raw 'GGGGEEEE'
        if (prop.length === 8) {
            let v = lookupTagHex(prop);
            if (!v) v = lookupTagRangeHex(prop);
            if (!v) return undefined;
            const tag = "(" + prop.slice(0, 4) + "," + prop.slice(4, 8) + ")";
            const entry = { tag, ...v, version: "DICOM" };
            cache.set(prop, entry);
            return entry;
        }

        // Private tags (creator string in key): lazy-loaded encoded dictionary
        if (isPrivateTagKey(prop)) {
            const v = privateModule.lookupPrivateTag(prop);
            if (!v) return undefined;
            const entry = { tag: prop, ...v, version: "PrivateTag" };
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
            const hex8 = _toHex8FromParenKey(prop);
            return (
                lookupTagHex(hex8) !== undefined ||
                lookupTagRangeHex(hex8) !== undefined
            );
        }
        if (prop.length === 8)
            return (
                lookupTagHex(prop) !== undefined ||
                lookupTagRangeHex(prop) !== undefined
            );
        if (isPrivateTagKey(prop) && privateModule)
            return privateModule.lookupPrivateTag(prop) !== undefined;
        return false;
    }
});
