// src/core/normalizeSyntax.js
import {
    EXPLICIT_BIG_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN
} from "../constants/dicom.js";

/**
 * Normalizes a transfer syntax UID to one of the three uncompressed body
 * framings the readers operate in. Any other syntax (encapsulated,
 * deflated post-inflate, unknown) reads as explicit little endian.
 *
 * Extracted from DicomMessage._normalizeSyntax (AD-5) so the streaming
 * source does not need to import the legacy reader for a pure utility.
 */
export function normalizeSyntax(syntax) {
    if (
        syntax == IMPLICIT_LITTLE_ENDIAN ||
        syntax == EXPLICIT_LITTLE_ENDIAN ||
        syntax == EXPLICIT_BIG_ENDIAN
    ) {
        return syntax;
    }
    return EXPLICIT_LITTLE_ENDIAN;
}
