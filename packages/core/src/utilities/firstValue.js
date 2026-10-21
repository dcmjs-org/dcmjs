// Single-value readers for naturalized DICOM values. A naturalized value can
// be a scalar, a multi-value array, or a one-element array; these return the
// first value in one plain type, or null when there is no usable value.

import { toFloat } from "./toFloat.js";

/**
 * The first value of a naturalized attribute as a trimmed string, or null
 * for an absent, empty, or blank value. A number (IS, DS) becomes its
 * string form. Another type (for example a PN object) gives null.
 *
 * @param {*} value - a naturalized value
 * @returns {string|null}
 */
export function toStringFirst(value) {
    if (Array.isArray(value)) {
        return value.length > 0 ? toStringFirst(value[0]) : null;
    }
    if (typeof value === "number") {
        return String(value);
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    return null;
}

/**
 * The first value of a naturalized attribute as a finite number (with
 * {@link toFloat}), or null for an absent value or a value that is not a
 * number.
 *
 * @param {*} value - a naturalized value
 * @returns {number|null}
 */
export function toFloatFirst(value) {
    if (Array.isArray(value)) {
        return value.length > 0 ? toFloatFirst(value[0]) : null;
    }
    if (value === undefined || value === null) {
        return null;
    }
    const number = toFloat(value);
    return Number.isFinite(number) ? number : null;
}
