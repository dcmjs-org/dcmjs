/**
 * Convert a string or value to an integer
 * Also converts an array to an array of int
 */
export function toInt(val) {
    if (Array.isArray(val)) {
        return val.map(toInt);
    }

    if (isNaN(val)) {
        throw new Error("Not a number: " + val);
    } else if (typeof val == "string") {
        return parseInt(val);
    }
    return val;
}
