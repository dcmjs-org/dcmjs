/**
 * Byte order conversion for the multi-byte words of a binary value field.
 *
 * Explicit VR Big Endian (1.2.840.10008.1.2.2) stores the words of a value
 * field most significant byte first (PS3.5 Section 7.3), so OW, OF and OD
 * values have to be swapped into the host's order when read, and back into
 * big endian when written, for callers to be able to view them as
 * Uint16Array/Float32Array/Float64Array.  OB is a byte stream and is never
 * swapped, and neither is UN, which is interpreted as OB.
 */

// Returns a Uint8Array over the same memory as data, or undefined if data
// isn't a buffer.  instanceof is deliberately avoided here, as buffers
// regularly arrive from another realm - a worker, an iframe, jsdom - where
// instanceof ArrayBuffer is false for a perfectly good ArrayBuffer.
function asBytes(data) {
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (data && typeof data.byteLength === "number") {
        return new Uint8Array(data);
    }
    return undefined;
}

/**
 * Reverses the bytes of every wordWidth sized word of data, in place.
 * A trailing partial word is left alone, as is anything that isn't an
 * ArrayBuffer or a view on one.
 *
 * @param {ArrayBuffer|ArrayBufferView} data value field to swap in place
 * @param {number} wordWidth bytes per word, 1 meaning "nothing to swap"
 * @returns data, for chaining
 */
function swapBytes(data, wordWidth) {
    const bytes = wordWidth > 1 ? asBytes(data) : undefined;
    if (!bytes) {
        return data;
    }
    const words = Math.floor(bytes.length / wordWidth);
    for (let word = 0, start = 0; word < words; word++, start += wordWidth) {
        for (let i = start, j = start + wordWidth - 1; i < j; i++, j--) {
            const swap = bytes[i];
            bytes[i] = bytes[j];
            bytes[j] = swap;
        }
    }
    return data;
}

/**
 * Same as swapBytes, but on a copy, so that a value field being written is
 * not modified on behalf of the caller.
 *
 * @param {ArrayBuffer|ArrayBufferView} data value field to swap
 * @param {number} wordWidth bytes per word, 1 meaning "nothing to swap"
 * @returns an ArrayBuffer holding the swapped bytes, or data unchanged when
 *     there is nothing to swap
 */
function swappedCopy(data, wordWidth) {
    const bytes = wordWidth > 1 ? asBytes(data) : undefined;
    if (!bytes) {
        return data;
    }
    const copy = bytes.slice();
    swapBytes(copy, wordWidth);
    return copy.buffer;
}

export { swapBytes, swappedCopy };
