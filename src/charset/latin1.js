/**
 * Guarded TextDecoder construction with a pure-JS latin1 fallback.
 *
 * Some mobile / embedded JS runtimes (react-native, older JavaScriptCore,
 * Hermes without full ICU) only ship a utf-8 TextDecoder and throw
 * `RangeError: The "latin1" encoding is not supported` for any other label
 * (https://github.com/dcmjs-org/dcmjs/issues/297). Since latin1 is a trivial
 * byte -> code-point mapping, fall back to a pure-JS decoder so the library
 * stays loadable and plain single-byte content stays readable on those
 * runtimes.
 *
 * Note: WHATWG "latin1" is actually windows-1252, which remaps 0x80-0x9F to
 * printable characters. The fallback uses the plain ISO-8859-1 byte ->
 * code-point identity instead — an accepted, graceful degradation that only
 * ever activates on runtimes without a native latin1 decoder.
 */

const LATIN1_LABELS = new Set([
    "latin1",
    "latin-1",
    "l1",
    "iso-8859-1",
    "iso8859-1",
    "iso88591",
    "iso_8859-1",
    "csisolatin1",
    "ansi_x3.4-1968",
    "ascii",
    "us-ascii",
    "windows-1252",
    "cp1252",
    "x-cp1252"
]);

function toUint8Array(input) {
    if (input == null) {
        return new Uint8Array(0);
    }
    if (input instanceof Uint8Array) {
        return input;
    }
    if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    return new Uint8Array(input);
}

class Latin1FallbackDecoder {
    get encoding() {
        return "latin1";
    }

    decode(input) {
        const bytes = toUint8Array(input);
        let result = "";
        // Chunked to keep fromCharCode argument counts within engine limits.
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            result += String.fromCharCode.apply(
                null,
                bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
            );
        }
        return result;
    }
}

/**
 * Constructs a TextDecoder for `label`, falling back to the pure-JS latin1
 * decoder when the runtime does not support a latin1-family label.
 * Non-latin1 labels propagate the runtime's error unchanged.
 */
export function createDecoder(label, options) {
    try {
        return new TextDecoder(label, options);
    } catch (err) {
        if (LATIN1_LABELS.has(String(label).toLowerCase())) {
            return new Latin1FallbackDecoder();
        }
        throw err;
    }
}

/** The default DICOM string decoder (guarded latin1). */
export function createLatin1Decoder() {
    return createDecoder("latin1");
}
