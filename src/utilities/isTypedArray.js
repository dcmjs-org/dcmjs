import isArrayBuffer from "./isArrayBuffer";

/**
 * Tell whether an obj is a TypedArray or not.
 *
 * @param {*} obj to be checked.
 * @returns boolean whether obj is TypedArray or not.
 */
const isTypedArray = obj =>
    obj && !!(isArrayBuffer(obj.buffer) && obj.BYTES_PER_ELEMENT);

export default isTypedArray;
