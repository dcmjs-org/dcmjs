import { lookupTagHex, lookupTagRangeHex } from "./dicom.lookup.js";

/** Set by registerPrivatesModule() at startup (index.js / index.umd). */
let privateModule = null;

/**
 * Register the private tag module (e.g. from dictionary.private.data.js).
 * Called at startup so privates are always available.
 */
export function registerPrivatesModule(module) {
    privateModule = module;
}

const cache = new Map();

// Tags registered through registerTag(), kept separately from `cache`. The cache
// also holds standard and private entries that were looked up lazily, so it
// cannot answer "what did the caller register". The dictionary Proxy has no
// ownKeys trap over the cache either, so Object.keys() on it reports only
// entries assigned directly onto it, never these.
const registered = new Map();

// Called with each newly registered entry so DicomMetaDictionary can keep its
// nameMap current. Injected rather than imported, because DicomMetaDictionary
// imports this module (as registerPrivatesModule is injected from index.js).
let nameMapRegistrar = null;

/**
 * Register a callback invoked with every entry passed to registerTag(),
 * including entries registered before this was called.
 *
 * @param {(entry: object) => void} fn
 * @returns {void}
 */
export function setNameMapRegistrar(fn) {
    nameMapRegistrar = typeof fn === "function" ? fn : null;
    if (nameMapRegistrar) {
        registered.forEach(entry => nameMapRegistrar(entry));
    }
}

/**
 * The entries registered through registerTag(), in registration order.
 *
 * @returns {object[]}
 */
export function registeredTagEntries() {
    return Array.from(registered.values());
}

function isPrivateTagKey(prop) {
    return (
        typeof prop === "string" && prop.length > 11 && prop.indexOf('"') !== -1
    );
}

function _toHex8FromParenKey(k) {
    // '(0008,0005)' -> '00080005'
    return k.slice(1, 5) + k.slice(6, 10);
}

function _toParenKeyFromHex8(hex8) {
    // '00080005' -> '(0008,0005)'
    return "(" + hex8.slice(0, 4) + "," + hex8.slice(4, 8) + ")";
}

/**
 * Register a tag entry in the cache so it is returned by the dictionary for that tag.
 * Use for tags not in the standard or private dictionaries.
 *
 * @param {string} tagOrHex - Tag as '(GGGG,EEEE)' or 'GGGGEEEE'
 * @param {{ name: string, vr: string, vm?: string, [key: string]: unknown }} entry - At least name and vr; vm and other fields optional
 * @returns {void}
 */
export function registerTag(tagOrHex, entry) {
    if (
        typeof tagOrHex !== "string" ||
        !entry ||
        typeof entry.name !== "string" ||
        typeof entry.vr !== "string"
    ) {
        return;
    }
    let parenKey;
    let hex8;
    if (
        tagOrHex.length === 11 &&
        tagOrHex[0] === "(" &&
        tagOrHex[5] === "," &&
        tagOrHex[10] === ")"
    ) {
        parenKey = tagOrHex;
        hex8 = _toHex8FromParenKey(tagOrHex);
    } else if (tagOrHex.length === 8) {
        hex8 = tagOrHex;
        parenKey = _toParenKeyFromHex8(tagOrHex);
    } else {
        return;
    }
    // Canonical form is upper case hex: that is what getAllStandardTagEntries()
    // carries, and what Tag.toCleanString() produces when a file is read, so a
    // tag registered in lower case would otherwise denaturalize to a key no
    // reader ever produces.
    const upperHex = hex8.toUpperCase();
    const upperParenKey = _toParenKeyFromHex8(upperHex);
    const cached = {
        tag: upperParenKey,
        ...entry,
        version: entry.version ?? "User"
    };
    // Lookups accept either case, as they do for the standard dictionary.
    for (const key of new Set([
        upperParenKey,
        upperHex,
        parenKey,
        hex8,
        _toParenKeyFromHex8(hex8.toLowerCase()),
        hex8.toLowerCase()
    ])) {
        cache.set(key, cached);
    }
    registered.set(upperParenKey, cached);
    // Keep nameMap current, so a registered tag can be written by name. Without
    // this, denaturalizeDataset() does not find the name and drops the value.
    if (nameMapRegistrar) {
        nameMapRegistrar(cached);
    }
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
            if (!v) {
                return undefined;
            }
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

        // Private tags: require registerPrivatesModule() at startup
        if (isPrivateTagKey(prop)) {
            if (!privateModule) return undefined;
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
        if (cache.has(prop)) return true;
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
