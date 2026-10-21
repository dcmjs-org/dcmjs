// packages/encapsulated/src/encapsulate.js
//
// The generic Encapsulated Document builder. The per-type wrappers
// (encapsulatePdf, and CDA/STL/... as they land) supply the base blocks.

import { base64ToArrayBuffer, createInstance } from "@dcmjs-org/core";
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

/**
 * Recover the document bytes from a naturalized Encapsulated Document
 * instance of any type (PDF, CDA, STL, OBJ, MTL). No SOP class check; see
 * extractEncapsulatedPdf for the PDF form.
 *
 * Accepts every payload shape a naturalized dataset produces: an ArrayBuffer
 * or a view, an array that wraps one, or the event-stream naturalizer's
 * `{ InlineBinary }` wrapper around a base64 string, an ArrayBuffer, or a
 * view.
 *
 * The Part 10 writer pads odd-length OB values with a trailing NUL. When
 * `EncapsulatedDocumentLength (0042,0015)` is present (encapsulate always
 * writes it), the payload is sliced to that exact length, so an even-length
 * original that ends in a zero byte survives (review finding 16). Without
 * the element, a single trailing 0x00 on an even stored length is trimmed
 * as pad only for a document type that never ends in 0x00: PDF, a text or
 * XML type (CDA, OBJ, MTL), or no MIME type (the PDF default). A binary
 * type such as STL keeps every byte.
 *
 * @param {Object} dataset - naturalized Encapsulated Document instance
 * @returns {Uint8Array|null} the document bytes, or null when the dataset
 *   has no EncapsulatedDocument
 */
export function extractEncapsulated(dataset) {
    let payload = dataset.EncapsulatedDocument;
    if (Array.isArray(payload)) {
        payload = payload[0];
    }
    if (payload === undefined || payload === null) {
        return null;
    }
    if (
        typeof payload === "object" &&
        !(payload instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(payload) &&
        payload.InlineBinary !== undefined
    ) {
        payload = Array.isArray(payload.InlineBinary)
            ? payload.InlineBinary[0]
            : payload.InlineBinary;
    }
    if (typeof payload === "string") {
        payload = base64ToArrayBuffer(payload);
    }
    const bytes = ArrayBuffer.isView(payload)
        ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
        : new Uint8Array(payload);

    let declaredLength = dataset.EncapsulatedDocumentLength;
    if (Array.isArray(declaredLength)) {
        declaredLength = declaredLength[0];
    }
    if (
        Number.isInteger(declaredLength) &&
        declaredLength >= 0 &&
        declaredLength <= bytes.byteLength
    ) {
        return bytes.subarray(0, declaredLength);
    }
    if (
        isPaddableMimeType(dataset.MIMETypeOfEncapsulatedDocument) &&
        bytes.byteLength > 0 &&
        bytes.byteLength % 2 === 0 &&
        bytes[bytes.byteLength - 1] === 0x00
    ) {
        return bytes.subarray(0, bytes.byteLength - 1);
    }
    return bytes;
}

// The types whose content never ends in 0x00 (see extractEncapsulated).
const PADDABLE_MIME_TYPES = new Set([
    "application/pdf",
    "application/xml",
    "model/obj",
    "model/mtl"
]);

function isPaddableMimeType(mimeType) {
    const type = (Array.isArray(mimeType) ? mimeType[0] : mimeType)
        ?.split(";")[0]
        .trim()
        .toLowerCase();
    return (
        !type ||
        PADDABLE_MIME_TYPES.has(type) ||
        type.startsWith("text/") ||
        type.endsWith("+xml")
    );
}
