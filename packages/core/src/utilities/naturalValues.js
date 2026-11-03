import addAccessors from "./addAccessors.js";
import isMultiVM from "./isMultiVM.js";
import { isEmptyBinary, naturalBinaryFragment } from "./binaryFragment.js";

/**
 * The value rules of the naturalized form (docs/specs/naturalized-dataset.md),
 * shared by both producers and the set utilities, so the three agree.
 */

/**
 * A sequence value (NAT-U-SQ): [] with no item; the array-like item object
 * for one item when the VM is 1 or there is no VM; else the list of items.
 *
 * @param {Object[]} [items]
 * @param {{vm?: string}} [entry] - the dictionary entry
 */
export function sequenceValue(items, entry) {
    if (!items || items.length === 0) return [];
    return items.length === 1 && !isMultiVM(entry?.vm)
        ? addAccessors(items)
        : items;
}

/**
 * A binary value (NAT-U-BIN-1): null with no bytes, else the list of its
 * fragments, each converted by naturalBinaryFragment when `binaryAs` is
 * given.
 *
 * @param {Array} [fragments]
 * @param {"ArrayBuffer"|"Uint8Array"} [binaryAs]
 */
export function binaryValue(fragments, binaryAs) {
    if (!fragments || isEmptyBinary(fragments)) return null;
    return binaryAs
        ? fragments.map(fragment => naturalBinaryFragment(fragment, binaryAs))
        : fragments.slice();
}

/**
 * A simple value (NAT-U-VAL-1, -2, -4): for a value count of 1, the single
 * value (null for none; more than one value keeps the list); else the list.
 *
 * @param {Array} values
 * @param {1|undefined} length - from valueLength(entry), or the caller
 */
export function simpleValue(values, length) {
    if (length !== 1) return values;
    if (values.length === 0) return null;
    return values.length === 1 ? values[0] : values;
}
