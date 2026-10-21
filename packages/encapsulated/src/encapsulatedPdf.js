// packages/encapsulated/src/encapsulatedPdf.js
//
// Encapsulated PDF IOD (PS3.3 A.45.1), SOP Class 1.2.840.10008.5.1.4.1.1.104.1.
// Two directions, matching the PACS workflow where PDFs travel inside DICOM:
//
//   encapsulatePdf(pdfBytes, options)  — PDF in:  wrap a PDF into a
//       naturalized dataset ready for the Part 10 writers
//       (which mint the Part 10 meta group).
//   extractEncapsulatedPdf(dataset)    — PDF out: recover the PDF bytes from
//       a parsed (naturalized) Encapsulated PDF instance.
//
// encapsulatePdf checks the PDF magic and calls the generic `encapsulate`
// with the PDF base (./defaults/pdfBase.js).

import {
    encapsulate,
    extractEncapsulated,
    toExactArrayBuffer
} from "./encapsulate.js";
import {
    encapsulatedPdfBase,
    ENCAPSULATED_PDF_SOP_CLASS_UID,
    PDF_MIME_TYPE
} from "./defaults/pdfBase.js";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function assertPdfMagic(arrayBuffer) {
    const head = new Uint8Array(
        arrayBuffer,
        0,
        Math.min(5, arrayBuffer.byteLength)
    );
    const isPdf =
        head.length === PDF_MAGIC.length &&
        PDF_MAGIC.every((byte, index) => head[index] === byte);
    if (!isPdf) {
        throw new Error(
            "encapsulatePdf: input does not look like a PDF (missing %PDF- magic)"
        );
    }
}

/**
 * Wrap PDF bytes into a naturalized Encapsulated PDF dataset.
 *
 * Checks the PDF magic, then calls {@link encapsulate} with
 * `encapsulatedPdfBase` as the default `baseDicom`. All other options
 * (`instance`, `dataLevel`, `levels`, `predecessor`, `postProcess`,
 * `mimeType`, and `overrides`) pass through; see `createInstance` in
 * `@dcmjs-org/core`. The DICOM attributes go in `overrides`, a naturalized
 * DICOM provider with the forms of `baseDicom`. Bytes without the `%PDF-`
 * magic throw an error (ENC-USR-11).
 *
 * @example
 * encapsulatePdf(pdfBytes, {
 *     instance,
 *     dataLevel: "series",
 *     overrides: { DocumentTitle: "v1" }
 * });
 *
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {Object} [options]
 * @returns {Object} naturalized dataset
 */
function encapsulatePdf(pdfBytes, options = {}) {
    const documentBytes = toExactArrayBuffer(pdfBytes);
    assertPdfMagic(documentBytes);
    return encapsulate(documentBytes, {
        ...options,
        // An undefined baseDicom means the default, as in encapsulate.
        baseDicom:
            options.baseDicom === undefined
                ? encapsulatedPdfBase
                : options.baseDicom
    });
}

/**
 * Recover the PDF from a naturalized Encapsulated PDF instance. Checks the
 * SOP class or the MIME type, then calls {@link extractEncapsulated}, which
 * documents the payload shapes and the pad handling (review finding 16). A
 * dataset that is not an Encapsulated PDF throws an error (ENC-USR-11).
 *
 * @param {Object} dataset - naturalized Encapsulated PDF instance
 * @returns {{ bytes: Uint8Array, mimeType: string, title: string }}
 */
function extractEncapsulatedPdf(dataset) {
    const mimeType = dataset.MIMETypeOfEncapsulatedDocument;
    const isEncapsulatedPdf =
        dataset.SOPClassUID === ENCAPSULATED_PDF_SOP_CLASS_UID ||
        mimeType === PDF_MIME_TYPE;
    if (!isEncapsulatedPdf || dataset.EncapsulatedDocument === undefined) {
        throw new Error(
            "extractEncapsulatedPdf: dataset is not an Encapsulated PDF " +
                "instance (expected SOP Class " +
                ENCAPSULATED_PDF_SOP_CLASS_UID +
                " with an EncapsulatedDocument)"
        );
    }

    return {
        bytes: extractEncapsulated(dataset) || new Uint8Array(0),
        mimeType: mimeType || PDF_MIME_TYPE,
        title: dataset.DocumentTitle || ""
    };
}

export {
    encapsulatePdf,
    extractEncapsulatedPdf,
    ENCAPSULATED_PDF_SOP_CLASS_UID,
    PDF_MIME_TYPE
};
