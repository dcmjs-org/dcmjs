// packages/encapsulated/src/encapsulate.js
//
// The generic Encapsulated Document builder. The per-type wrappers
// (encapsulatePdf, and CDA/STL/... as they land) supply the base blocks.

import { createInstance } from "@dcmjs-org/core";
import { encapsulatedBase } from "./defaults/encapsulatedDocumentBase.js";

/**
 * Normalize ArrayBuffer | Uint8Array | Node Buffer to an exact ArrayBuffer.
 * Views are sliced by byteOffset/byteLength — a bare `.buffer` on a pooled
 * Node Buffer would hand back unrelated pool bytes. Another value is
 * returned as it is; the function does not check the type (CORE-IMP-11).
 */
export function toExactArrayBuffer(bytes) {
    if (ArrayBuffer.isView(bytes)) {
        return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
        );
    }
    return bytes;
}

/**
 * Build a naturalized Encapsulated Document dataset with
 * {@link createInstance}, then set the document payload.
 *
 * The MIME type is `mimeType`, else the `MIMETypeOfEncapsulatedDocument` of
 * the merged dataset (overrides, then inherited, then base). `mimeType` is
 * set after `createInstance`, so it wins over each form of `overrides`
 * (ENC-USR-4). `_meta` is a copy of the merged `_meta` (CORE-USR-13), with
 * the Explicit VR Little Endian default from the core base; a writer that
 * stores the data in another transfer syntax must update it.
 *
 * The options follow CORE-USR-1 (`packages/core/README.md`): the options
 * object holds the controls, and the DICOM attributes go in
 * `options.overrides`, a naturalized DICOM provider with the forms of
 * `baseDicom`. An extra option key has no effect (CORE-USR-7). With
 * `dataLevel: "series"`, `instance` is the sample instance in the series
 * (CORE-USR-5).
 *
 * `EncapsulatedDocumentLength (0042,0015)` records the exact byte length,
 * because the writer pads an odd-length OB value; see extractEncapsulatedPdf.
 *
 * @example
 * encapsulate(bytes, {
 *     instance,
 *     mimeType: "text/xml",
 *     overrides: { DocumentTitle: "Report" }
 * });
 *
 * @param {ArrayBuffer|Uint8Array} bytes - the document bytes to encapsulate
 * @param {Object} [options] - the {@link createInstance} options
 *   (`instance`, `dataLevel`, `levels`, `predecessor`, `postProcess`,
 *   `overrides`), plus:
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
    // A copy, so the result does not share _meta with overrides._meta
    // (CORE-USR-13).
    if (dataset._meta) {
        dataset._meta = { ...dataset._meta };
    }

    return dataset;
}
