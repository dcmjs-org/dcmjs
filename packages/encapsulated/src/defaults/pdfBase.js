// packages/encapsulated/src/defaults/pdfBase.js
//
// The PDF-identifying defaults the generic `encapsulate` builder layers under
// the caller's context and overrides. These are the attributes that are the
// same for every Encapsulated PDF instance — the SOP class, Modality, the SC
// Equipment conversion fields, and the encoding seed. The per-call fields
// (minted UIDs, dates, the document bytes) are supplied by `encapsulate`.
//
// Returned from a factory rather than a shared frozen constant so each
// `encapsulatePdf` call gets its own object and callers can't mutate a shared
// default.

import { EXPLICIT_LITTLE_ENDIAN } from "@dcmjs-org/core";

export const ENCAPSULATED_PDF_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.104.1";
export const PDF_MIME_TYPE = "application/pdf";

/** A fresh Encapsulated PDF base-defaults object. */
export function pdfBase() {
    return {
        SpecificCharacterSet: "ISO_IR 192",
        SOPClassUID: ENCAPSULATED_PDF_SOP_CLASS_UID,
        Modality: "DOC",
        ConversionType: "WSD",
        Manufacturer: "dcmjs",
        BurnedInAnnotation: "YES",
        MIMETypeOfEncapsulatedDocument: PDF_MIME_TYPE,
        _meta: { TransferSyntaxUID: { Value: [EXPLICIT_LITTLE_ENDIAN] } },
        _vrMap: { EncapsulatedDocument: "OB" }
    };
}
