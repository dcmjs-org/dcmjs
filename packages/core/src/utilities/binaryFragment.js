const BINARY_AS = new Set(["ArrayBuffer", "Uint8Array"]);

const isSharedBuffer = v =>
    typeof SharedArrayBuffer !== "undefined" && v instanceof SharedArrayBuffer;

/** True for bytes: an ArrayBuffer, a SharedArrayBuffer, or a view. */
export function isBinaryData(v) {
    return (
        v instanceof ArrayBuffer || ArrayBuffer.isView(v) || isSharedBuffer(v)
    );
}

/**
 * Checks the `binaryAs` naturalize option and gives its value.
 *
 * @param {string} [binaryAs="ArrayBuffer"]
 * @returns {"ArrayBuffer"|"Uint8Array"}
 */
export function checkBinaryAs(binaryAs = "ArrayBuffer") {
    if (!BINARY_AS.has(binaryAs)) {
        throw new TypeError(
            `binaryAs must be "ArrayBuffer" or "Uint8Array", not "${binaryAs}"`
        );
    }
    return binaryAs;
}

/**
 * One fragment or frame of a binary value in the naturalized form
 * (NAT-U-BIN in docs/specs/naturalized-dataset.md).
 *
 * - "ArrayBuffer" (the default): an ArrayBuffer. A view that covers its whole
 *   buffer gives that buffer; any other view is copied to its own buffer.
 * - "Uint8Array": a Uint8Array over the same bytes, never a copy.
 *
 * Anything that is not an ArrayBuffer or a view, for example a
 * `{ BulkDataURI }` reference, is returned unchanged.
 */
export function naturalBinaryFragment(fragment, binaryAs = "ArrayBuffer") {
    if (fragment instanceof ArrayBuffer) {
        return binaryAs === "Uint8Array" ? new Uint8Array(fragment) : fragment;
    }
    if (isSharedBuffer(fragment)) {
        // a shared buffer is not an ArrayBuffer: the default mode copies it
        const view = new Uint8Array(fragment);
        return binaryAs === "Uint8Array" ? view : view.slice().buffer;
    }
    if (!ArrayBuffer.isView(fragment)) {
        return fragment;
    }
    const { buffer, byteOffset, byteLength } = fragment;
    if (binaryAs === "Uint8Array") {
        return new Uint8Array(buffer, byteOffset, byteLength);
    }
    if (!(buffer instanceof ArrayBuffer)) {
        // a view over a shared buffer
        return new Uint8Array(buffer, byteOffset, byteLength).slice().buffer;
    }
    return byteOffset === 0 && byteLength === buffer.byteLength
        ? buffer
        : buffer.slice(byteOffset, byteOffset + byteLength);
}
