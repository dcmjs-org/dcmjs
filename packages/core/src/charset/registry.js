// The SpecificCharacterSet registry: decoder + encoder per normalized term.
// Unregistered terms fall back to encodingMapping, read at lookup time.
import { encodingMapping } from "../constants/dicom.js";
import { log } from "../log.js";
import { createDecoder } from "./latin1.js";

/**
 * One SpecificCharacterSet defined term. Give `label` (a WHATWG Encoding
 * label) and/or `createDecoder`; a label builds the decoder and, for UTF-8
 * and single-byte encodings, the encoder. `encode` null means no encoder.
 * @typedef {Object} CharacterSet
 * @property {string} [label]
 * @property {() => {decode(input: BufferSource): string}} [createDecoder]
 * @property {((text: string, options?: {ignoreErrors?: boolean}) => Uint8Array)|null} [encode]
 */

const MULTI_BYTE =
    /^(shift_jis|euc-jp|iso-2022-jp|euc-kr|gbk|gb18030|big5|utf-16(le|be)|replacement)$/;
const registered = {};
const byLabel = {};
const warned = new Set();
const utf8Encoder = new TextEncoder();

/**
 * Normalizes a (0008,0005) value to the `encodingMapping` key form
 * ("ISO_IR 100" gives "iso-ir-100"); strips the NUL padding of old modalities.
 */
export function normalizeCharacterSetTerm(value) {
    return String(value ?? "")
        .replace(/\0/g, "")
        .trim()
        .replace(/[_ ]/g, "-")
        .toLowerCase();
}

/**
 * The encoder of a label: TextEncoder for UTF-8, a reverse table of the
 * decoder over 0x00-0xFF for a single-byte encoding, null otherwise. A
 * single-byte encoder throws on a character it cannot hold, or writes `?`
 * with `options.ignoreErrors`.
 */
function encoderForLabel(label) {
    let decoder;
    try {
        decoder = createDecoder(label);
    } catch {
        return null;
    }
    if (decoder.encoding === "utf-8") {
        return text => utf8Encoder.encode(text);
    }
    if (MULTI_BYTE.test(decoder.encoding)) {
        return null;
    }
    const table = new Map();
    for (let byte = 255; byte >= 0; byte--) {
        const char = decoder.decode(Uint8Array.of(byte));
        if (char !== "�") table.set(char, byte);
    }
    return (text, options = {}) => {
        const out = [];
        for (const char of text) {
            let byte = table.get(char);
            if (byte === undefined) {
                if (!options.ignoreErrors) {
                    throw new Error(
                        `"${char}" (U+${char
                            .codePointAt(0)
                            .toString(16)
                            .toUpperCase()}) is not in the character set ${label}`
                    );
                }
                byte = 0x3f;
            }
            out.push(byte);
        }
        return Uint8Array.from(out);
    };
}

function characterSetForLabel(label) {
    return (byLabel[label] ??= {
        label,
        createDecoder: () => createDecoder(label),
        encode: encoderForLabel(label)
    });
}

/**
 * Adds or replaces a SpecificCharacterSet defined term for read and write.
 * `encodingMapping[term]` becomes the label (null without a label).
 * @example registerCharacterSet("ISO-IR100", { label: "latin1" });
 * @param {string} term the defined term as written in (0008,0005)
 * @param {CharacterSet} characterSet
 * @returns {CharacterSet}
 */
export function registerCharacterSet(term, { label, createDecoder, encode }) {
    if (!label && !createDecoder) {
        throw new Error(
            `registerCharacterSet(${term}): give a label or createDecoder`
        );
    }
    const code = normalizeCharacterSetTerm(term);
    const entry = { ...(label && characterSetForLabel(label)) };
    if (createDecoder) entry.createDecoder = createDecoder;
    entry.encode = encode !== undefined ? encode : entry.encode ?? null;
    registered[code] = entry;
    encodingMapping[code] = label ?? null;
    warned.delete(code);
    return entry;
}

/** The CharacterSet of a normalized term, or undefined. */
export function lookupCharacterSet(code) {
    if (registered[code]) return registered[code];
    const label = Object.hasOwn(encodingMapping, code) && encodingMapping[code];
    return label ? characterSetForLabel(label) : undefined;
}

/**
 * The text encoder (`{ encode(text) }`) for a dataset or item that declares
 * `values` in (0008,0005). No encoder (multi-byte, ISO 2022, multi-valued,
 * unknown) gives UTF-8 bytes, as before, with one warning per term.
 * @param {string[]|string} values
 * @param {{ignoreErrors?: boolean}} [writeOptions]
 */
export function createCharacterSetEncoder(values, writeOptions) {
    const list = [].concat(values ?? []);
    const key = list.join("\\");
    const encode =
        list.length < 2 &&
        lookupCharacterSet(normalizeCharacterSetTerm(list[0]))?.encode;
    if (!encode) {
        if (!warned.has(key)) {
            warned.add(key);
            log.warn(
                `No encoder for the character set "${key}"; writing UTF-8 bytes`
            );
        }
        return utf8Encoder;
    }
    const options = { ignoreErrors: writeOptions?.ignoreErrors };
    return { encode: text => encode(text, options) };
}
