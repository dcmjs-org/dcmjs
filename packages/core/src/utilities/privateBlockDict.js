import { ValueRepresentation } from "../ValueRepresentation.js";
import {
    creatorText,
    firstFreeBlock,
    privateBlockKey
} from "./privateBlocks.js";

/**
 * Private blocks of a DICOM JSON dict (keys 'GGGGEEEE'), per PS3.5 7.8.1.
 *
 * The naturalized form groups a block under its block key (privateBlocks.js);
 * these functions give the same names at the dict level, for a caller that
 * builds or reads a dict directly (DicomDict, DicomMessage.readFile):
 *
 *     dicomDict.privateBlock("4D43:ACME 1.0").set("x01", "CS", ["HYBRID"]);
 *     findPrivateBlock(dict, "4D43:ACME 1.0")?.get("x01").Value;
 *
 * A block is named by its block key or by (group, creator); an element by
 * its number 0x00-0xFF or its element key "xEE". The creator is the
 * identity: the block number (`reservedBlock`) is looked up, or reserved at
 * the first free xx, never assumed. docs/specs/naturalized-dataset.md
 * NAT-U-PRIV-11 is the specification.
 */

const CREATOR_MAX_LENGTH = 64; // LO
const BLOCK_KEY = /^([0-9A-Fa-f]{4}):(.+)$/s;
const ELEMENT_KEY = /^x([0-9A-Fa-f]{2})$/;

const hex2 = n => n.toString(16).toUpperCase().padStart(2, "0");
const hex4 = n => n.toString(16).toUpperCase().padStart(4, "0");

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
        creator = match[2].replace(/\\r/g, "\r").replace(/\\n/g, "\n");
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
            dict[key] = {
                vr,
                Value: ValueRepresentation.addValueAccessorsFor(
                    vr,
                    Array.isArray(values) ? values : [values]
                )
            };
            return key;
        }
    };
}

/**
 * Finds the block a creator has reserved in a dict.
 *
 * @param {Object} dict DICOM JSON dict, keyed by 'GGGGEEEE'
 * @param {number|string} groupOrKey odd group number, or block key "gggg:creator"
 * @param {string} [creator] creator string, with a group number
 * @returns {Object|null} a block accessor, or null when the creator is absent
 */
export function findPrivateBlock(dict, groupOrKey, creator) {
    const [group, wanted] = blockArgs(groupOrKey, creator);
    for (let xx = 0x10; xx <= 0xff; xx++) {
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
 * @param {Object} dict DICOM JSON dict, keyed by 'GGGGEEEE'
 * @param {number|string} groupOrKey odd group number, or block key "gggg:creator"
 * @param {string} [creator] creator string, with a group number
 * @returns {Object} a block accessor
 */
export function reservePrivateBlock(dict, groupOrKey, creator) {
    const existing = findPrivateBlock(dict, groupOrKey, creator);
    if (existing) return existing;
    const [group, wanted] = blockArgs(groupOrKey, creator);
    const prefix = hex4(group);
    const used = new Set();
    for (const key of Object.keys(dict)) {
        if (key.length !== 8 || key.slice(0, 4).toUpperCase() !== prefix) {
            continue;
        }
        const element = parseInt(key.slice(4), 16);
        used.add(element <= 0xff ? element : element >> 8);
    }
    const xx = firstFreeBlock(used);
    if (xx === undefined) {
        throw new Error(
            `No free private block in group ${prefix} - all of 0x10 to 0xFF are reserved`
        );
    }
    dict[prefix + hex4(xx)] = { vr: "LO", Value: [wanted] };
    return blockAccessor(dict, group, wanted, xx);
}
