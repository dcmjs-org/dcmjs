import { DicomMetaDictionary } from "../DicomMetaDictionary.js";
import { lookupRegisteredTagByName } from "../dictionary.fast.js";
import BINARY_VRS from "./binaryVRs.js";
import { valueLength } from "./isMultiVM.js";
import { binaryValue, sequenceValue, simpleValue } from "./naturalValues.js";
import {
    isHexTag,
    isPrivateTag,
    hasPrivateAliasRecord,
    privateAliasTarget,
    registeredTagEntry
} from "./privateBlocks.js";
import {
    definePersonNameAccessor,
    toPersonNameValue
} from "./personNameValue.js";
import { isVrCode, vrNeedsRecord } from "./vrMap.js";
import { checkBinaryAs } from "./binaryFragment.js";

/**
 * Utilities that add or replace one attribute of a naturalized dataset in
 * the naturalized form (docs/specs/naturalized-dataset.md, NAT-U-SET).
 */

/**
 * The naturalized key of `key` in `dataset` (NAT-U-SET-4): an 8-digit hex
 * tag is uppercase. A standard hex tag, or a private one with no block alias
 * (live or deleted), is its keyword when the dictionary or registerTag() has
 * one. A deleted block alias keeps its hex name, so a set after the delete
 * makes a new flat element (NAT-U-HIST-7).
 */
function naturalKey(dataset, key) {
    if (!isHexTag(key)) return key;
    const hexTag = key.toUpperCase();
    if (isPrivateTag(hexTag) && hasPrivateAliasRecord(dataset, hexTag)) {
        return hexTag;
    }
    return registeredTagEntry(hexTag)?.name || hexTag;
}

/** Throws for a private creator alias, which is read-only (NAT-U-SET-4). */
function assertNotCreator(dataset, key) {
    const alias = privateAliasTarget(dataset, key);
    if (alias && alias.elementKey === null) {
        throw new TypeError(
            `${key} is the creator of private block ${alias.key}; change the block key to change the creator`
        );
    }
    return alias;
}

/** The dictionary entry of a keyword, a registerTag() keyword or a hex tag. */
function entryFor(key) {
    if (isHexTag(key)) return registeredTagEntry(key);
    return DicomMetaDictionary.nameMap[key] || lookupRegisteredTagByName(key);
}

/**
 * Sets the VR of one attribute in `dataset._vrMap`, and creates `_vrMap`
 * when the dataset has none. A private hex alias (or registerTag() keyword)
 * of a block element sets the VR of that element in its block. A private
 * creator is always LO, so a creator alias changes nothing (NAT-U-VR-3).
 *
 * @param {Object} dataset - a naturalized dataset or sequence item
 * @param {string} key - the attribute key, or a private block key
 * @param {string} vr - for example "LO"
 * @param {string} [elementKey] - with a block key: the element, e.g. "x01"
 */
export function setVr(dataset, key, vr, elementKey) {
    if (elementKey === undefined) {
        key = naturalKey(dataset, key);
        const alias = privateAliasTarget(dataset, key);
        if (alias && alias.elementKey === null) return;
        if (alias) {
            key = alias.key;
            elementKey = alias.elementKey;
        }
    }
    if (!dataset._vrMap) dataset._vrMap = {};
    if (elementKey === undefined) {
        dataset._vrMap[key] = vr;
        return;
    }
    dataset._vrMap[key] = dataset._vrMap[key] || {};
    dataset._vrMap[key][elementKey] = vr;
}

/**
 * Adds or replaces an attribute in the naturalized form. `length` is the
 * value count: 1 stores a single value (null for no value); any other
 * length stores a list ([] for no value), as for VM > 1. Without `length`,
 * the dictionary VM decides, and an attribute with no dictionary VM (a
 * private or unknown element) is a list. A sequence stores its items by
 * NAT-U-SQ (the array-like item object for one item), a binary VR stores a
 * list of fragments or null, and a PN value goes through setPersonName. The
 * VR goes into `_vrMap` when the dictionary does not fix it.
 *
 * @param {Object} dataset - a naturalized dataset or sequence item
 * @param {string} key - a keyword, an 8-digit hex tag, or a private alias
 * @param {*} value
 * @param {Object} [options]
 * @param {string} [options.vr] - the VR, when the dictionary has none
 * @param {number} [options.length] - the value count
 * @param {"ArrayBuffer"|"Uint8Array"} [options.binaryAs="ArrayBuffer"] -
 *   the type of each fragment of a binary value
 * @returns {*} the stored value
 */
export function setAttribute(dataset, key, value, options = {}) {
    key = naturalKey(dataset, key);
    const alias = assertNotCreator(dataset, key);
    const entry = entryFor(key);
    const vr = options.vr || entry?.vr;
    if (vr === "PN") {
        return setPersonName(dataset, key, value, options.length);
    }
    const values = value == null ? [] : [].concat(value);
    let shaped;
    if (vr === "SQ") {
        shaped = sequenceValue(values, entry);
    } else if (BINARY_VRS.has(vr) || vr === "ox") {
        // "ox" (OB or OW, as PixelData) is binary too (NAT-U-BIN-1/2)
        shaped = binaryValue(values, checkBinaryAs(options.binaryAs));
    } else {
        const length =
            "length" in options ? options.length : valueLength(entry);
        shaped = simpleValue(values, length);
    }
    if (!alias && Object.getOwnPropertyDescriptor(dataset, key)?.set) {
        // a PN setter from an earlier VR: the attribute is plain data now
        delete dataset[key];
    }
    dataset[key] = shaped;
    storeVr(dataset, key, entry, vr);
    return shaped;
}

/**
 * Adds or replaces a PN attribute. The value (a PN string such as
 * "Doe^John" or "A^B\\C^D", a component object, or a list) is stored in the
 * component form (toPersonNameValue), and the attribute gets the converting
 * setter, so a later assignment of a string converts too. `length` is the
 * value count: 1 for one name (null for none), else a list. Without
 * `length`, the dictionary VM decides (PatientName gives one name).
 *
 * @param {Object} dataset - a naturalized dataset or sequence item
 * @param {string} key - a keyword, an 8-digit hex tag, or a private alias
 * @param {*} value
 * @param {number} [length]
 * @returns {Object|Object[]|null} the stored value
 */
export function setPersonName(dataset, key, value, length) {
    key = naturalKey(dataset, key);
    assertNotCreator(dataset, key);
    const entry = entryFor(key);
    if (length === undefined) length = valueLength(entry);
    if (privateAliasTarget(dataset, key)) {
        // a private block element: the alias stores into the block, and
        // converts later strings because _vrMap gives PN (storeVr below)
        dataset[key] = toPersonNameValue(value, length);
    } else {
        definePersonNameAccessor(dataset, key, length, value);
    }
    storeVr(dataset, key, entry, "PN");
    return dataset[key];
}

// The VR goes into _vrMap by the rule of vrNeedsRecord (NAT-I-VR-1); a
// private block element always records it in its block.
function storeVr(dataset, key, entry, vr) {
    // a dictionary code such as "ox" is not a VR, so it is not recorded
    if (!isVrCode(vr)) return;
    if (privateAliasTarget(dataset, key) || vrNeedsRecord(entry, vr)) {
        setVr(dataset, key, vr);
    }
}
