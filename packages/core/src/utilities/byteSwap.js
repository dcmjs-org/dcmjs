/** A Uint8Array over the bytes of data, or undefined when data has no bytes. */
function asBytes(data) {
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    // not instanceof: a buffer from another realm (worker, jsdom) fails it
    if (data && typeof data.byteLength === "number") {
        return new Uint8Array(data);
    }
    return undefined;
}

/**
 * Reverses the bytes of each word of data, in place: Explicit VR Big Endian
 * to the little endian in-memory form (PS3.5 Section 7.3), or back.
 * @param {ArrayBuffer|ArrayBufferView} data
 * @param {number} wordWidth bytes per word; 1 changes nothing
 * @returns data
 */
export function swapBytes(data, wordWidth) {
    const bytes = wordWidth > 1 ? asBytes(data) : undefined;
    if (!bytes) {
        return data;
    }
    const end = bytes.length - (bytes.length % wordWidth);
    for (let start = 0; start < end; start += wordWidth) {
        for (let i = start, j = start + wordWidth - 1; i < j; i++, j--) {
            const b = bytes[i];
            bytes[i] = bytes[j];
            bytes[j] = b;
        }
    }
    return data;
}

/**
 * {@link swapBytes} on a copy. Gives data itself when there is nothing to
 * swap, so the caller must not modify the result.
 */
export function swappedCopy(data, wordWidth) {
    const bytes = wordWidth > 1 ? asBytes(data) : undefined;
    return bytes ? swapBytes(bytes.slice(), wordWidth).buffer : data;
}
