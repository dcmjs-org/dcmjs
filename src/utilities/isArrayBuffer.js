/**
 * Tell whether an obj is an instance of ArrayBuffer or not.
 *
 * @param {*} obj to be checked.
 * @returns boolean whether obj is ArrayBuffer or not.
 */
const isArrayBuffer = obj => obj instanceof ArrayBuffer;

export default isArrayBuffer;
