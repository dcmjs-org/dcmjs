// Base64 for binary values (DICOM JSON InlineBinary, FHIR attachment data),
// in Node and in the browser.

const CHUNK = 0x8000;

/**
 * Encode bytes as a base64 string. Uses Node's Buffer when present, else
 * btoa over chunks that stay under the argument-length limit.
 *
 * @param {ArrayBuffer|ArrayBufferView} bytes
 * @returns {string}
 */
export function encodeBase64(bytes) {
    const view = ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes);
    if (typeof Buffer !== "undefined") {
        return Buffer.from(
            view.buffer,
            view.byteOffset,
            view.byteLength
        ).toString("base64");
    }
    let binary = "";
    for (let offset = 0; offset < view.length; offset += CHUNK) {
        binary += String.fromCharCode(...view.subarray(offset, offset + CHUNK));
    }
    return btoa(binary);
}

/**
 * Decode a base64 string into an exact ArrayBuffer. Uses Node's Buffer
 * when present, else atob.
 *
 * @param {string} b64
 * @returns {ArrayBuffer}
 */
export function base64ToArrayBuffer(b64) {
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
