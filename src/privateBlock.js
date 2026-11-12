import { ValueRepresentation } from "./ValueRepresentation.js";

/**
 * Private block reservation, per PS3.5 Section 7.8.1.
 *
 * A private group is odd. Within it, a Private Creator Data Element at
 * (gggg,00xx) - where xx is 0x10 through 0xFF - identifies an implementer and
 * reserves the block of Data Elements (gggg,xx00) through (gggg,xxFF) for them.
 *
 * Which block a creator gets is decided by whoever wrote the file, so the
 * creator string is the identity and the block has to be looked up. A block
 * is named as in the 1.0 naturalized form: the block key "gggg:creator"
 * (for example "4D43:ACME 1.0"), or the pair (group, creator); an element of
 * the block is its number 0x00-0xFF, or the element key "xEE" (for example
 * "x01"):
 *
 *     // writing
 *     const block = dicomDict.privateBlock("4D43:ACME 1.0");
 *     block.set("x01", "CS", ["HYBRID"]);   // -> (4D43,1001), or wherever it landed
 *
 *     // reading, from any parsed dict
 *     const found = findPrivateBlock(dict, "4D43:ACME 1.0");
 *     found && found.get("x01").Value;
 */

const CREATOR_MIN = 0x10;
const CREATOR_MAX = 0xff;
const CREATOR_MAX_LENGTH = 64; // LO
const BLOCK_KEY = /^([0-9A-Fa-f]{4}):(.+)$/s;
const ELEMENT_KEY = /^x([0-9A-Fa-f]{2})$/;

const hex2 = n => n.toString(16).toUpperCase().padStart(2, "0");
const hex4 = n => n.toString(16).toUpperCase().padStart(4, "0");

/**
 * The block key "gggg:creator" of a group and creator. A line break in the
 * creator is written as the text `\n` (and `\r`); LO holds no backslash, so
 * the key reads back to the same creator.
 */
export function privateBlockKey(group, creator) {
    const text = creator.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    return `${hex4(group)}:${text}`;
}

/** The creator of the creator part of a block key: `\n` and `\r` unescaped. */
function keyCreator(text) {
    return text.replace(/\\r/g, "\r").replace(/\\n/g, "\n");
}

/**
 * The creator text of a creator element value: no leading spaces, no
 * trailing spaces or NULs. A value in bytes (UN) is read as Latin-1.
 */
function creatorText(value) {
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === "string") return v.replace(/^ +|[\0 ]+$/g, "");
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
        const bytes = ArrayBuffer.isView(v)
            ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
            : new Uint8Array(v);
        return creatorText(String.fromCharCode(...bytes.subarray(0, 64)));
    }
    return "";
}

/** [group, creator] from (groupOrKey, creator), validated. */
function blockArgs(groupOrKey, creator) {
    let group = groupOrKey;
    if (typeof groupOrKey === "string") {
        const match = BLOCK_KEY.exec(groupOrKey);
        if (!match) {
            throw new Error(
                `Private block key must be "gggg:creator", got ${groupOrKey}`
            );
        }
        group = parseInt(match[1], 16);
        creator = keyCreator(match[2]);
    }
    if (!Number.isInteger(group) || group < 0 || group > 0xffff) {
        throw new Error(`Private group must be a 16 bit number, got ${group}`);
    }
    if (group % 2 === 0) {
        throw new Error(
            `Private group must be odd, got ${hex4(
                group
            )} - an even group is standard, not private`
        );
    }
    if (typeof creator !== "string" || creatorText(creator).length === 0) {
        throw new Error("Private creator must be a non-empty string");
    }
    creator = creatorText(creator);
    if (creator.length > CREATOR_MAX_LENGTH) {
        throw new Error(
            `Private creator must be at most ${CREATOR_MAX_LENGTH} characters (LO), got ${creator.length}`
        );
    }
    return [group, creator];
}

/** The element number of 0x00-0xFF or "xEE". */
function elementNumber(element) {
    const match = typeof element === "string" && ELEMENT_KEY.exec(element);
    const n = match ? parseInt(match[1], 16) : element;
    if (!Number.isInteger(n) || n < 0x00 || n > 0xff) {
        throw new Error(
            `Private element must be 0x00 to 0xFF or "xEE", got ${element}`
        );
    }
    return n;
}

/**
 * An accessor for one reserved block of a dict, keyed by 'GGGGEEEE'.
 * `reservedBlock` is the xx of the block in this dict.
 */
function blockAccessor(dict, group, creator, reservedBlock) {
    const tag = element =>
        hex4(group) + hex2(reservedBlock) + hex2(elementNumber(element));
    return {
        key: privateBlockKey(group, creator),
        group,
        creator,
        reservedBlock,
        /** The 'GGGGEEEE' key of an element of this block. */
        tag,
        /** Whether this block holds that element. */
        has: element =>
            Object.prototype.hasOwnProperty.call(dict, tag(element)),
        /** The element object, or undefined. */
        get: element => dict[tag(element)],
        /**
         * Writes an element of this block, as DicomDict#upsertTag does.
         *
         * @param {number|string} element 0x00 to 0xFF, or "xEE"
         * @param {string} vr value representation
         * @param {*} values value, or array of values
         * @returns {string} the tag that was written
         */
        set: (element, vr, values) => {
            const key = tag(element);
            dict[key] = ValueRepresentation.addTagAccessors({ vr });
            dict[key].Value = Array.isArray(values) ? values : [values];
            return key;
        }
    };
}

/**
 * Finds the block a creator has reserved in a dict.
 *
 * @param {object} dict parsed dataset, keyed by 'GGGGEEEE'
 * @param {number|string} groupOrKey odd group number, or block key "gggg:creator"
 * @param {string} [creator] creator string, with a group number
 * @returns {object|null} a block accessor, or null when the creator is absent
 */
export function findPrivateBlock(dict, groupOrKey, creator) {
    const [group, wanted] = blockArgs(groupOrKey, creator);
    for (let xx = CREATOR_MIN; xx <= CREATOR_MAX; xx++) {
        const element = dict[hex4(group) + hex4(xx)];
        if (element && creatorText(element.Value) === wanted) {
            return blockAccessor(dict, group, wanted, xx);
        }
    }
    return null;
}

/**
 * Finds the block a creator has reserved, or reserves the first free block
 * and writes the creator element. A block is free when the dict holds no
 * creator element for it and no element in its range.
 *
 * @param {object} dict parsed dataset, keyed by 'GGGGEEEE'
 * @param {number|string} groupOrKey odd group number, or block key "gggg:creator"
 * @param {string} [creator] creator string, with a group number
 * @returns {object} a block accessor
 */
export function reservePrivateBlock(dict, groupOrKey, creator) {
    const existing = findPrivateBlock(dict, groupOrKey, creator);
    if (existing) return existing;
    const [group, wanted] = blockArgs(groupOrKey, creator);
    const prefix = hex4(group);
    const used = new Set();
    for (const key of Object.keys(dict)) {
        if (!key.startsWith(prefix) || key.length !== 8) continue;
        const element = parseInt(key.slice(4), 16);
        used.add(element <= 0xff ? element : element >> 8);
    }
    for (let xx = CREATOR_MIN; xx <= CREATOR_MAX; xx++) {
        if (!used.has(xx)) {
            dict[prefix + hex4(xx)] = ValueRepresentation.addTagAccessors({
                vr: "LO"
            });
            dict[prefix + hex4(xx)].Value = [wanted];
            return blockAccessor(dict, group, wanted, xx);
        }
    }
    throw new Error(
        `No free private block in group ${prefix} - all of 0x10 to 0xFF are reserved`
    );
}
