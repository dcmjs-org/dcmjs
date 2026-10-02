/**
 * Convert a value to a float
 */
export function toFloat(val) {
    if (Array.isArray(val)) {
        return val.map(toFloat);
    }
    if (typeof val == "string") {
        return parseFloat(val);
    }
    return val;
}
