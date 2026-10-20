// packages/encapsulated/src/encapsulate.js
//
// The generic Encapsulated Document builder. The per-type wrappers
// (encapsulatePdf, and CDA/STL/... as they land) supply the base blocks.

import { createInstance } from "@dcmjs-org/core";
import { encapsulatedBase } from "./defaults/encapsulatedDocumentBase.js";

/**
 * Normalize ArrayBuffer | Uint8Array | Node Buffer to an exact ArrayBuffer.
 * Views are sliced by byteOffset/byteLength — a bare `.buffer` on a pooled
 * Node Buffer would hand back unrelated pool bytes.
 */
export function toExactArrayBuffer(bytes) {
    if (bytes instanceof ArrayBuffer) {
        return bytes;
    }
    if (ArrayBuffer.isView(bytes)) {
        return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
        );
    }
    throw new Error(
        "encapsulate expects an ArrayBuffer or Uint8Array of document bytes"
    );
}

/**
 * Build a naturalized Encapsulated Document dataset with
 * {@link createInstance}, then set the document payload.
 *
 * The MIME type is `mimeType`, else the `MIMETypeOfEncapsulatedDocument` of
 * the merged dataset (overrides, then inherited, then base). `_meta` is the
 * Explicit VR Little Endian default from the core base; a writer that stores
 * the data in another transfer syntax must update it.
 *
 * `EncapsulatedDocumentLength (0042,0015)` records the exact byte length,
 * because the writer pads an odd-length OB value; see extractEncapsulatedPdf.
 *
 * @param {ArrayBuffer|Uint8Array} bytes - the document bytes to encapsulate
 * @param {Object} [options] - the {@link createInstance} options, plus:
 * @param {*} [options.baseDicom=encapsulatedBase] - base blocks
 * @param {string} [options.mimeType] - a specialization of the MIME type
 * @returns {Object} naturalized dataset, ready for the Part 10 writers
 */
export function encapsulate(bytes, options = {}) {
    const { baseDicom = encapsulatedBase, mimeType, ...rest } = options;

    const documentBytes = toExactArrayBuffer(bytes);
    const dataset = createInstance({ baseDicom, ...rest });

    if (mimeType) {
        dataset.MIMETypeOfEncapsulatedDocument = mimeType;
    }
    dataset.EncapsulatedDocumentLength = documentBytes.byteLength;
    dataset.EncapsulatedDocument = documentBytes;
    dataset._vrMap = { ...(dataset._vrMap || {}), EncapsulatedDocument: "OB" };

    return dataset;
}
