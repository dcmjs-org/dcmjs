// Base64 for binary values (DICOM JSON InlineBinary, FHIR attachment data),
// in Node and in the browser.

const CHUNK = 0x8000;

/**
 * Encode bytes as a base64 string. Uses the native
 * `Uint8Array.prototype.toBase64` when present, else Node's Buffer, else
 * btoa over chunks that stay under the argument-length limit.
 *
 * @param {ArrayBuffer|ArrayBufferView} bytes
 * @returns {string}
 */
export function encodeBase64(bytes) {
    const view = ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes);
    if (typeof view.toBase64 === "function") {
        return view.toBase64();
    }
    if (typeof Buffer !== "undefined") {
        return Buffer.from(
            view.buffer,
            view.byteOffset,
            view.byteLength
        ).toString("base64");
    }
    const parts = [];
    for (let offset = 0; offset < view.length; offset += CHUNK) {
        parts.push(
            String.fromCharCode(...view.subarray(offset, offset + CHUNK))
        );
    }
    return btoa(parts.join(""));
}

/**
 * Decode a base64 string into an exact ArrayBuffer. Uses the native
 * `Uint8Array.fromBase64` when present, else Node's Buffer, else atob.
 *
 * @param {string} b64
 * @returns {ArrayBuffer}
 */
export function base64ToArrayBuffer(b64) {
    if (typeof Uint8Array.fromBase64 === "function") {
        return Uint8Array.fromBase64(b64).buffer;
    }
    if (typeof Buffer !== "undefined") {
        const buf = Buffer.from(b64, "base64");
        return buf.buffer.slice(
            buf.byteOffset,
            buf.byteOffset + buf.byteLength
        );
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
