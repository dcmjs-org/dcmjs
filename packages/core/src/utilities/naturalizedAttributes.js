import { DicomMetaDictionary } from "../DicomMetaDictionary.js";
import { dictionary, lookupRegisteredTagByName } from "../dictionary.fast.js";
import BINARY_VRS from "./binaryVRs.js";
import { isEmptyBinary } from "./binaryFragment.js";
import { privateAliasTarget } from "./privateBlocks.js";
import {
    definePersonNameAccessor,
    toPersonNameValue
} from "./personNameValue.js";
import { recordVr } from "./vrMap.js";

/**
 * Utilities that add or replace one attribute of a naturalized dataset in
 * the naturalized form (docs/specs/naturalized-dataset.md, NAT-U-UPS).
 */

const HEX_TAG = /^[0-9A-Fa-f]{8}$/;

/** The dictionary entry of a keyword, a registerTag() keyword or a hex tag. */
function entryFor(key) {
    if (HEX_TAG.test(key)) {
        return dictionary[`(${key.slice(0, 4)},${key.slice(4, 8)})`];
    }
    return DicomMetaDictionary.nameMap[key] || lookupRegisteredTagByName(key);
}

/**
 * Sets the VR of one attribute in `dataset._vrMap`, and creates `_vrMap`
 * when the dataset has none. A private hex alias (or registerTag() keyword)
 * of a block element sets the VR of that element in its block.
 *
 * @param {Object} dataset - a naturalized dataset or sequence item
 * @param {string} key - the attribute key, or a private block key
 * @param {string} vr - for example "LO"
 * @param {string} [elementKey] - with a block key: the element, e.g. "x01"
 */
export function setVr(dataset, key, vr, elementKey) {
    if (!dataset._vrMap) dataset._vrMap = {};
    const alias =
        elementKey === undefined ? privateAliasTarget(dataset, key) : null;
    if (alias && alias.elementKey) {
        key = alias.key;
        elementKey = alias.elementKey;
    }
    if (elementKey === undefined) {
        dataset._vrMap[key] = vr;
        return;
    }
    dataset._vrMap[key] = dataset._vrMap[key] || {};
    dataset._vrMap[key][elementKey] = vr;
}

/** The naturalized shape of a simple value for a value count. */
function shapeValues(value, length) {
    if (length === 1) {
        if (!Array.isArray(value)) return value ?? null;
        return value.length <= 1 ? value[0] ?? null : value;
    }
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

/**
 * Adds or replaces an attribute whose value count the dictionary does not
 * fix, for example a private or unknown element. `length` is the value
 * count: 1 stores a single value (null for no value); any other length, or
 * none, stores a list ([] for no value), as for VM > 1. A binary VR stores a
 * list of fragments, or null with no bytes. A PN value goes through
 * upsertPersonName. The VR goes into `_vrMap` when the dictionary does not
 * fix it.
 *
 * @param {Object} dataset - a naturalized dataset or sequence item
 * @param {string} key - a keyword, an 8-digit hex tag, or a private alias
 * @param {*} value
 * @param {Object} [options]
 * @param {string} [options.vr] - the VR, when the dictionary has none
 * @param {number} [options.length] - the value count
 * @returns {*} the stored value
 */
export function upsertAttribute(dataset, key, value, options = {}) {
    const entry = entryFor(key);
    const vr = options.vr || entry?.vr;
    if (vr === "PN") {
        return upsertPersonName(dataset, key, value, options.length);
    }
    let shaped;
    if (BINARY_VRS.has(vr)) {
        const fragments = value == null ? [] : [].concat(value);
        shaped = isEmptyBinary(fragments) ? null : fragments;
    } else {
        shaped = shapeValues(value, options.length);
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
 * value count: 1 for one name (null for none), else a list.
 *
 * @param {Object} dataset - a naturalized dataset or sequence item
 * @param {string} key - a keyword, an 8-digit hex tag, or a private alias
 * @param {*} value
 * @param {number} [length]
 * @returns {Object|Object[]|null} the stored value
 */
export function upsertPersonName(dataset, key, value, length) {
    if (privateAliasTarget(dataset, key)) {
        // a private block element: the alias stores into the block
        dataset[key] = toPersonNameValue(value, length);
    } else {
        dataset[key] = value;
        definePersonNameAccessor(dataset, key, length);
    }
    storeVr(dataset, key, entryFor(key), "PN");
    return dataset[key];
}

// The VR goes into _vrMap by the rule of recordVr (NAT-I-VR-1); a private
// block element always records it in its block.
function storeVr(dataset, key, entry, vr) {
    if (!vr) return;
    if (privateAliasTarget(dataset, key)) {
        setVr(dataset, key, vr);
        return;
    }
    const probe = {};
    recordVr(probe, key, entry, vr);
    if (key in probe) setVr(dataset, key, vr);
}
