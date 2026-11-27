import { lookupTagHex, lookupTagRangeHex } from "./dicom.lookup.js";
import log from "./log.js";

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
const nameCache = new Map();

/** Set by DicomMetaDictionary at load: the entry of an existing keyword. */
let keywordLookup = null;

/**
 * Set the lookup of existing keywords that registerTag() checks. Injected,
 * because DicomMetaDictionary imports this module.
 *
 * @param {(name: string) => { tag: string } | undefined} fn
 */
export function setKeywordLookup(fn) {
    keywordLookup = fn;
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
 * The tag is stored in upper case, the case that a reader makes, and lookups
 * accept both cases. The tag of the first argument wins over `entry.tag`.
 * Name rules (docs/specs/registries.md, REG-U-18 to REG-U-21):
 * - A name that is an existing keyword of a different tag throws.
 * - When two tags use one name, the first tag keeps the name and a warning
 *   names both tags. The second tag gets its hex tag as its name, and keeps
 *   its VR and VM.
 * - A new name for a registered tag replaces the old name.
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
    const upperHex = hex8.toUpperCase();
    const lowerHex = hex8.toLowerCase();
    const tag = _toParenKeyFromHex8(upperHex);
    const keyword = keywordLookup?.(entry.name);
    if (keyword && keyword.tag.toUpperCase() !== tag) {
        throw new Error(
            `registerTag: name ${entry.name} is the keyword of ${keyword.tag}; ` +
                `${tag} cannot use it`
        );
    }
    let name = entry.name;
    const existing = nameCache.get(name);
    if (existing && existing.tag !== tag) {
        log.warn(
            `registerTag: name ${name} already maps to ${existing.tag}; ` +
                `${tag} uses the name ${upperHex}`
        );
        name = upperHex;
    }
    const previous = cache.get(upperHex);
    if (previous && nameCache.get(previous.name) === previous) {
        nameCache.delete(previous.name);
    }
    const cached = {
        ...entry,
        name,
        tag,
        version: entry.version ?? "User"
    };
    for (const key of new Set([
        upperHex,
        lowerHex,
        hex8,
        parenKey,
        _toParenKeyFromHex8(upperHex),
        _toParenKeyFromHex8(lowerHex)
    ])) {
        cache.set(key, cached);
    }
    nameCache.set(name, cached);
}

/**
 * Look up a registerTag() entry by its keyword name, so registration is
 * symmetric: the same call that teaches naturalizeDataset a custom name
 * also lets denaturalizeDataset map the name back to its tag. Kept as a
 * registry-local index rather than a write into
 * DicomMetaDictionary.nameMap, so reading a dataset never mutates the
 * shared name map.
 *
 * @param {string} name - Keyword passed to registerTag() as entry.name
 * @returns {{ tag: string, name: string, vr: string } | undefined}
 */
export function lookupRegisteredTagByName(name) {
    return nameCache.get(name);
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
