/**
 * Deep clone of a naturalized instance, or of one naturalized value. It
 * handles only what naturalized data holds: plain objects, arrays, binary
 * (ArrayBuffer and typed arrays), and primitives. It is not a general clone:
 * a Map, Set, Date, or class instance does not survive.
 *
 * - Binary values are shared, not copied, unless `copyBinary` is set: pixel
 *   data and documents can be large enough that a copy runs out of memory.
 * - A promise (any thenable) gives a new promise for the clone of its value.
 * - A function is wrapped: `deepCloneInstance(fn)` returns a function that
 *   passes all its arguments to `fn` and returns the clone of the result, so
 *   a base block can return a fresh clone on each call. The wrapper keeps
 *   `fn.items` (see `combineBases`).
 *
 * For example, `createInstance({ instance: deepCloneInstance(source) })`
 * gives a result whose sequences are independent of `source`.
 *
 * @param {*} value - a naturalized instance or value, a promise, or a function
 * @param {Object} [options]
 * @param {boolean} [options.copyBinary=false] - copy ArrayBuffers and views
 * @returns {*} the clone
 */
export function deepCloneInstance(value, options = {}) {
    const clone = item => deepCloneInstance(item, options);
    if (typeof value === "function") {
        const cloning = (...args) => clone(value(...args));
        if (value.items) {
            cloning.items = value.items;
        }
        return cloning;
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (typeof value.then === "function") {
        return value.then(clone);
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return options.copyBinary ? value.slice(0) : value;
    }
    if (Array.isArray(value)) {
        return value.map(clone);
    }
    const copy = {};
    for (const key of Object.keys(value)) {
        copy[key] = clone(value[key]);
    }
    return copy;
}
