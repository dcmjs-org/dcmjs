/**
 * ISO 2022 code-extension support for DICOM SpecificCharacterSet (0008,0005).
 *
 * PS3.3 C.12.1.1.2 allows (0008,0005) to be multi-valued when ISO 2022 code
 * extensions are in use (e.g. "\\ISO 2022 IR 149", "ISO 2022 IR 13\\ISO 2022
 * IR 87"): the text then switches character sets mid-value via ISO 2022
 * escape sequences. This module provides
 *
 *   - resolveCharsetDecoder(values, { ignoreErrors }): the single shared
 *     charset resolution used by every read path (eager DicomMessage._read,
 *     decodeCore.resolveCharacterSet for the event-stream and lazy paths).
 *     Single-valued charsets keep the historical encodingMapping ->
 *     TextDecoder behavior byte-for-byte; multi-valued ISO 2022 charsets
 *     resolve to an Iso2022Decoder; multi-valued NON-ISO-2022 charsets keep
 *     the historical "Using multiple character sets is not supported" error
 *     (warn-and-use-first under ignoreErrors).
 *
 *   - Iso2022Decoder: a TextDecoder-shaped ({ decode(input, options) })
 *     escape-sequence-aware segment decoder. It tracks the G0/G1 designations
 *     ISO 2022 escapes establish and decodes each run of bytes with a
 *     decoder appropriate to the active designation:
 *       ESC ( B          -> G0 ASCII
 *       ESC ( J          -> G0 JIS X 0201 romaji
 *       ESC ( I / ) I    -> G0 / G1 JIS X 0201 katakana (shift_jis bytes)
 *       ESC $ @ / $ B    -> G0 JIS X 0208 kanji (decoded via iso-2022-jp)
 *       ESC $ ( D        -> G0 JIS X 0212 (best effort via iso-2022-jp)
 *       ESC $ ) C        -> G1 KS X 1001 (decoded via euc-kr)
 *       ESC $ ) A        -> G1 GB 2312 (decoded via gb18030)
 *       ESC - <F>        -> G1 ISO 8859 right-hand halves (latin1, greek, ...)
 *     Per PS3.5 6.1.2.5.3 the designations reset to the value-1 default after
 *     control characters and value/component delimiters (backslash always;
 *     ^ and = additionally for PN via options.delimiters).
 *
 * Related issues: #373 (multi-valued (0008,0005) must parse), #284 (Korean /
 * IR 149), #454 and #484 (escape-switched JIS text, scoped decoding).
 */

import { encodingMapping } from "../constants/dicom.js";
import { log } from "../log.js";
import { createDecoder } from "./latin1.js";

const ESC = 0x1b;

// G0 designations with dedicated decode strategies.
const G0_ASCII = "ascii";
const G0_ROMAJI = "romaji"; // JIS X 0201 GL — decoded as ASCII/shift_jis
const G0_KATAKANA = "g0-katakana"; // JIS X 0201 katakana designated to G0
const G0_JISX0208 = "jisx0208";
const G0_JISX0212 = "jisx0212";

// G1 designations. Single-byte ISO 8859 right-hand halves are represented
// directly by their TextDecoder label (string values below are labels too,
// distinguished by the dedicated constants being checked first).
const G1_KATAKANA = "g1-katakana";
const G1_EUCKR = "g1-euc-kr";
const G1_GB2312 = "g1-gb2312";

/** Bytes after which the designations reset to the charset default. */
const DEFAULT_RESET_BYTES = new Set([
    0x09, // TAB
    0x0a, // LF
    0x0c, // FF
    0x0d, // CR
    0x5c // backslash — DICOM value delimiter
]);

/** Additional reset delimiters for PN values (PS3.5 6.1.2.5.3). */
export const PN_DELIMITER_BYTES = new Set([
    0x5e, // ^  component delimiter
    0x3d // =  component-group delimiter
]);

/**
 * ESC intermediate+final sequence -> state mutation. Keys are the printable
 * bytes following the ESC byte.
 */
const ESCAPE_HANDLERS = {
    "(B": state => (state.g0 = G0_ASCII),
    "(J": state => (state.g0 = G0_ROMAJI),
    "(I": state => (state.g0 = G0_KATAKANA),
    ")I": state => (state.g1 = G1_KATAKANA),
    "$@": state => (state.g0 = G0_JISX0208),
    $B: state => (state.g0 = G0_JISX0208),
    "$(D": state => (state.g0 = G0_JISX0212),
    "$)C": state => (state.g1 = G1_EUCKR),
    "$)A": state => (state.g1 = G1_GB2312),
    "-A": state => (state.g1 = "latin1"),
    "-B": state => (state.g1 = "iso-8859-2"),
    "-C": state => (state.g1 = "iso-8859-3"),
    "-D": state => (state.g1 = "iso-8859-4"),
    "-F": state => (state.g1 = "iso-8859-7"),
    "-G": state => (state.g1 = "iso-8859-6"),
    "-H": state => (state.g1 = "iso-8859-8"),
    "-L": state => (state.g1 = "iso-8859-5"),
    "-M": state => (state.g1 = "iso-8859-9"),
    "-T": state => (state.g1 = "tis-620")
};

/** Initial G0/G1 designations implied by the FIRST (0008,0005) value. */
function initialStateFor(code) {
    switch (code) {
        case "":
        case "iso-ir-6":
        case "iso-2022-ir-6":
            return { g0: G0_ASCII, g1: null };
        case "iso-ir-13":
        case "iso-2022-ir-13":
            return { g0: G0_ROMAJI, g1: G1_KATAKANA };
        case "iso-ir-87":
        case "iso-2022-ir-87":
            return { g0: G0_JISX0208, g1: null };
        case "iso-ir-149":
        case "iso-2022-ir-149":
            return { g0: G0_ASCII, g1: G1_EUCKR };
        case "iso-ir-58":
        case "iso-2022-ir-58":
            return { g0: G0_ASCII, g1: G1_GB2312 };
        default:
            // Single-byte GR sets (ISO 8859 family, TIS 620): decode GR via
            // the mapped label; unknown codes fall back to no G1 (latin1
            // passthrough, the historical default).
            return { g0: G0_ASCII, g1: encodingMapping[code] ?? null };
    }
}

const decoderCache = new Map();

function decodeWith(label, bytes) {
    let decoder = decoderCache.get(label);
    if (!decoder) {
        decoder = createDecoder(label);
        decoderCache.set(label, decoder);
    }
    return decoder.decode(bytes);
}

function withPrefix(prefix, bytes) {
    const out = new Uint8Array(prefix.length + bytes.length);
    out.set(prefix, 0);
    out.set(bytes, prefix.length);
    return out;
}

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

export class Iso2022Decoder {
    constructor(initialCode = "") {
        this.initialState = initialStateFor(initialCode);
    }

    get encoding() {
        return "iso-2022";
    }

    /**
     * Decodes `input` (BufferSource) honoring ISO 2022 escape sequences.
     * `options.delimiters` may carry a Set of additional byte values (e.g.
     * PN's ^ and =) after which the designations reset to the default.
     */
    decode(input, options) {
        const bytes = toUint8Array(input);
        const extraDelimiters = options?.delimiters ?? null;
        let state = { ...this.initialState };
        let out = "";
        let runStart = 0;
        let i = 0;

        const flush = end => {
            if (end > runStart) {
                out += decodeRun(bytes.subarray(runStart, end), state);
            }
        };

        while (i < bytes.length) {
            const b = bytes[i];
            if (b === ESC) {
                flush(i);
                i = applyEscape(bytes, i, state);
                runStart = i;
            } else if (state.g0 === G0_JISX0208 || state.g0 === G0_JISX0212) {
                // Inside a multi-byte G0 designation every byte (including
                // 0x5C etc.) is character data — no delimiter scanning.
                i++;
            } else if (
                b < 0x80 &&
                (DEFAULT_RESET_BYTES.has(b) ||
                    (extraDelimiters && extraDelimiters.has(b)))
            ) {
                // Delimiter: decode it with the current run, then reset the
                // designations to the charset default (PS3.5 6.1.2.5.3).
                flush(i + 1);
                state = { ...this.initialState };
                i++;
                runStart = i;
            } else {
                i++;
            }
        }
        flush(bytes.length);
        return out;
    }
}

/**
 * Parses the escape sequence starting at bytes[escIndex] === ESC, applies the
 * matching designation change to `state` (unknown sequences are skipped with
 * a warning, leaving the state unchanged), and returns the index of the first
 * byte after the sequence.
 */
function applyEscape(bytes, escIndex, state) {
    let j = escIndex + 1;
    let seq = "";
    // Intermediate bytes 0x20-0x2F, then one final byte 0x30-0x7E.
    while (j < bytes.length && bytes[j] >= 0x20 && bytes[j] <= 0x2f) {
        seq += String.fromCharCode(bytes[j]);
        j++;
    }
    if (j < bytes.length && bytes[j] >= 0x30 && bytes[j] <= 0x7e) {
        seq += String.fromCharCode(bytes[j]);
        j++;
    }
    const handler = ESCAPE_HANDLERS[seq];
    if (handler) {
        handler(state);
    } else {
        log.warn(
            `Unsupported ISO 2022 escape sequence: ESC ${seq || "<truncated>"}`
        );
    }
    return j;
}

/** Decodes one escape-free run of bytes according to the designations. */
function decodeRun(runBytes, state) {
    if (state.g0 === G0_JISX0208) {
        // Hand the escape-prefixed bytes to the native iso-2022-jp decoder.
        return decodeWith(
            "iso-2022-jp",
            withPrefix([0x1b, 0x24, 0x42], runBytes)
        );
    }
    if (state.g0 === G0_JISX0212) {
        // Best effort: WHATWG iso-2022-jp has no JIS X 0212 support, so this
        // may yield replacement characters rather than raw escape bytes.
        return decodeWith(
            "iso-2022-jp",
            withPrefix([0x1b, 0x24, 0x28, 0x44], runBytes)
        );
    }
    if (state.g0 === G0_KATAKANA) {
        // 7-bit katakana in G0: shift GL bytes to the shift_jis single-byte
        // katakana range.
        const shifted = runBytes.map(b =>
            b >= 0x21 && b <= 0x5f ? b + 0x80 : b
        );
        return decodeWith("shift_jis", shifted);
    }
    if (state.g1 === G1_KATAKANA) {
        // JIS X 0201: GL romaji/ASCII + GR katakana — exactly the shift_jis
        // single-byte repertoire.
        return decodeWith("shift_jis", runBytes);
    }
    if (state.g1 === G1_EUCKR) {
        return decodeWith("euc-kr", runBytes);
    }
    if (state.g1 === G1_GB2312) {
        return decodeWith("gb18030", runBytes);
    }
    if (typeof state.g1 === "string") {
        return decodeWith(state.g1, runBytes);
    }
    // No G1 designated: latin1 passthrough (historical default behavior).
    return decodeWith("latin1", runBytes);
}

/** Normalizes one (0008,0005) value to the encodingMapping key form. */
function normalizeCode(value) {
    return String(value ?? "")
        .trim()
        .replace(/[_ ]/g, "-")
        .toLowerCase();
}

/**
 * Resolves the decoder for a SpecificCharacterSet (0008,0005) value list.
 *
 * Returns a TextDecoder (single supported charset), an Iso2022Decoder
 * (multi-valued ISO 2022 code extensions), or null (no values, or
 * unsupported under ignoreErrors). Throws with the historical error
 * messages when ignoreErrors is false.
 */
export function resolveCharsetDecoder(values, options = {}) {
    const { ignoreErrors = false } = options;
    if (!values || values.length === 0) {
        return null;
    }
    const codes = values.map(normalizeCode);

    if (values.length === 1) {
        const coding = codes[0];
        if (coding in encodingMapping) {
            return createDecoder(encodingMapping[coding]);
        }
        if (ignoreErrors) {
            log.warn(
                `Unsupported character set: ${coding}, using default character set`
            );
            return null;
        }
        throw Error(`Unsupported character set: ${coding}`);
    }

    // Multi-valued (0008,0005): only valid for ISO 2022 code extensions
    // (PS3.3 C.12.1.1.2) — every value must be an "ISO 2022 ..." defined
    // term (the first may be empty, meaning the default repertoire).
    const isCodeExtension = codes.every(
        (code, index) =>
            code.startsWith("iso-2022-") || (index === 0 && code === "")
    );
    if (!isCodeExtension) {
        if (ignoreErrors) {
            log.warn(
                "Using multiple character sets is not supported, proceeding with just the first character set",
                values
            );
            return resolveCharsetDecoder([values[0]], options);
        }
        throw Error(
            `Using multiple character sets is not supported: ${values}`
        );
    }
    for (const code of codes) {
        if (code !== "" && !(code in encodingMapping)) {
            if (ignoreErrors) {
                log.warn(
                    `Unsupported character set: ${code}, using default character set`
                );
            } else {
                throw Error(`Unsupported character set: ${code}`);
            }
        }
    }
    return new Iso2022Decoder(codes[0]);
}
