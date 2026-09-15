// src/encapsulated/encapsulatedPdf.js
//
// Encapsulated PDF IOD (PS3.3 A.45.1), SOP Class 1.2.840.10008.5.1.4.1.1.104.1.
// Two directions, matching the PACS workflow where PDFs travel inside DICOM:
//
//   encapsulatePdf(pdfBytes, options)  — PDF in:  wrap a PDF into a
//       naturalized dataset ready for data.datasetToBuffer()/datasetToDict()
//       (which mint the Part 10 meta group).
//   extractEncapsulatedPdf(dataset)    — PDF out: recover the PDF bytes from
//       a parsed (naturalized) Encapsulated PDF instance.
//
// This is a de novo builder, deliberately NOT a DerivedDataset — derivations
// copy patient/study context from a referenced source instance; an
// encapsulated PDF starts from a plain PDF plus caller-supplied context.

import { DicomMetaDictionary } from "../DicomMetaDictionary.js";

const ENCAPSULATED_PDF_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.104.1";
const PDF_MIME_TYPE = "application/pdf";
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * Normalize ArrayBuffer | Uint8Array | Node Buffer to an exact ArrayBuffer.
 * Views are sliced by byteOffset/byteLength — a bare `.buffer` on a pooled
 * Node Buffer would hand back unrelated pool bytes.
 */
function toExactArrayBuffer(bytes) {
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
        "encapsulatePdf expects an ArrayBuffer or Uint8Array of PDF bytes"
    );
}

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
 * The result carries `_meta` (Explicit VR Little Endian) and `_vrMap`
 * (EncapsulatedDocument pinned to OB) so `datasetToDict`/`datasetToBuffer`
 * can serialize it to Part 10 directly. Every UID defaults to a freshly
 * minted `DicomMetaDictionary.uid()`; pass `StudyInstanceUID` (and
 * optionally `SeriesInstanceUID`) to attach the document into an existing
 * study.
 *
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {Object} [options] - naturalized keyword overrides (PatientName,
 *   PatientID, DocumentTitle, StudyInstanceUID, ...)
 * @returns {Object} naturalized dataset
 */
function encapsulatePdf(pdfBytes, options = {}) {
    const documentBytes = toExactArrayBuffer(pdfBytes);
    assertPdfMagic(documentBytes);

    const date = DicomMetaDictionary.date();
    const time = DicomMetaDictionary.time();

    const dataset = {
        // SOP Common
        SpecificCharacterSet: "ISO_IR 192",
        SOPClassUID: ENCAPSULATED_PDF_SOP_CLASS_UID,
        SOPInstanceUID: options.SOPInstanceUID || DicomMetaDictionary.uid(),

        // General Study (Type 2 attributes always present)
        StudyInstanceUID: options.StudyInstanceUID || DicomMetaDictionary.uid(),
        StudyDate: options.StudyDate || date,
        StudyTime: options.StudyTime || time,
        ReferringPhysicianName: options.ReferringPhysicianName || "",
        StudyID: options.StudyID || "",
        AccessionNumber: options.AccessionNumber || "",

        // Patient
        PatientName: options.PatientName || "",
        PatientID: options.PatientID || "",
        PatientBirthDate: options.PatientBirthDate || "",
        PatientSex: options.PatientSex || "",

        // Encapsulated Document Series
        Modality: "DOC",
        SeriesInstanceUID:
            options.SeriesInstanceUID || DicomMetaDictionary.uid(),
        SeriesNumber: options.SeriesNumber || 1,

        // SC Equipment
        ConversionType: options.ConversionType || "WSD",
        Manufacturer: options.Manufacturer || "dcmjs",

        // Encapsulated Document
        InstanceNumber: options.InstanceNumber || 1,
        ContentDate: options.ContentDate || date,
        ContentTime: options.ContentTime || time,
        AcquisitionDateTime:
            options.AcquisitionDateTime || DicomMetaDictionary.dateTime(),
        BurnedInAnnotation: options.BurnedInAnnotation || "YES",
        DocumentTitle: options.DocumentTitle || "",
        MIMETypeOfEncapsulatedDocument: PDF_MIME_TYPE,
        EncapsulatedDocument: documentBytes,

        _meta: {
            TransferSyntaxUID: {
                Value: ["1.2.840.10008.1.2.1"]
            }
        },
        _vrMap: {
            EncapsulatedDocument: "OB"
        }
    };

    if (options.SeriesDescription) {
        dataset.SeriesDescription = options.SeriesDescription;
    }
    if (options.ConceptNameCodeSequence) {
        dataset.ConceptNameCodeSequence = options.ConceptNameCodeSequence;
    }

    return dataset;
}

/**
 * Recover the PDF from a naturalized Encapsulated PDF instance.
 *
 * The Part 10 writer pads odd-length OB values with a trailing NUL; a single
 * trailing 0x00 (never valid PDF content) is trimmed so the result is
 * byte-identical to the originally encapsulated document.
 *
 * @param {Object} dataset - DicomMetaDictionary.naturalizeDataset output
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

    let payload = dataset.EncapsulatedDocument;
    if (Array.isArray(payload)) {
        payload = payload[0];
    }
    // The event-stream naturalizer wraps binary as { InlineBinary } (an
    // ArrayBuffer, a view, or a base64 string); unwrap before extracting.
    if (
        payload &&
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
        const binary = atob(payload);
        const decoded = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            decoded[i] = binary.charCodeAt(i);
        }
        payload = decoded;
    }
    let bytes = ArrayBuffer.isView(payload)
        ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
        : new Uint8Array(payload);

    if (
        bytes.byteLength > 0 &&
        bytes.byteLength % 2 === 0 &&
        bytes[bytes.byteLength - 1] === 0x00
    ) {
        bytes = bytes.subarray(0, bytes.byteLength - 1);
    }

    return {
        bytes,
        mimeType: mimeType || PDF_MIME_TYPE,
        title: dataset.DocumentTitle || ""
    };
}

export {
    encapsulatePdf,
    extractEncapsulatedPdf,
    ENCAPSULATED_PDF_SOP_CLASS_UID
};
