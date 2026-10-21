// packages/encapsulated/src/defaults/pdfBase.js
//
// The PDF-only base block, and the default combination for Encapsulated PDF.

import {
    combineBases,
    defaultInstanceBase,
    predecessorBase
} from "@dcmjs-org/core";
import { encapsulatedDocumentBase } from "./encapsulatedDocumentBase.js";

export const ENCAPSULATED_PDF_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.104.1";
export const PDF_MIME_TYPE = "application/pdf";

/** The attributes that identify an Encapsulated PDF. */
export const pdfBase = {
    SOPClassUID: ENCAPSULATED_PDF_SOP_CLASS_UID,
    Modality: "DOC",
    MIMETypeOfEncapsulatedDocument: PDF_MIME_TYPE
};

/**
 * The default base of `encapsulatePdf`: core instance defaults, the shared
 * encapsulated-document block, the predecessor block, and the PDF block. Use
 * `.items` to build a variant with a part replaced.
 */
export const encapsulatedPdfBase = combineBases(
    defaultInstanceBase,
    encapsulatedDocumentBase,
    predecessorBase,
    pdfBase
);
