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
// The builder defaults to de novo construction — a plain PDF plus
// caller-supplied context, with everything omitted defaulted. It is NOT a
// DerivedDataset: it never references a source instance or copies its full
// module set. But because the common case is attaching a report to a study
// you already hold an instance of, `options.sourceInstance` offers the
// lightweight middle ground the full derivation machinery would be overkill
// for: copy the Patient and General Study context off that instance, mint
// everything that must be new. Precedence is defaults < sourceInstance <
// explicit options; the document's own identity (SOP class, Modality,
// SOP/Series UIDs) is never inherited. See copyContextFromInstance.

import { DicomMetaDictionary } from "@dcmjs-org/core";

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

// The Patient and General Study attributes carried over from a
// `sourceInstance`. Deliberately NOT the whole module set: the document's
// own identity (SOP class/UID, Series UID, Modality) must stay the
// encapsulated PDF's own, and the SC Equipment / Encapsulated Document
// attributes describe the PDF, not the source. SeriesInstanceUID is omitted
// on purpose so the report lands in a fresh series within the source study.
const INHERITABLE_CONTEXT = [
    // Patient
    "PatientName",
    "PatientID",
    "PatientBirthDate",
    "PatientSex",
    // General Study
    "StudyInstanceUID",
    "StudyDate",
    "StudyTime",
    "ReferringPhysicianName",
    "StudyID",
    "AccessionNumber"
];

/**
 * Pull the inheritable Patient/General Study context off a naturalized source
 * instance. A sequence of instances from one study shares that context, so an
 * array is accepted and its first element is read. Only attributes actually
 * present (and non-empty) are returned, so an empty Type 2 value on the
 * source never shadows a builder default. Returns {} when no source is given.
 */
function copyContextFromInstance(sourceInstance) {
    if (sourceInstance === undefined || sourceInstance === null) {
        return {};
    }
    const source = Array.isArray(sourceInstance)
        ? sourceInstance[0]
        : sourceInstance;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error(
            "encapsulatePdf: options.sourceInstance must be a naturalized " +
                "dataset (or a non-empty array of them)"
        );
    }
    const context = {};
    for (const key of INHERITABLE_CONTEXT) {
        if (source[key] !== undefined && source[key] !== "") {
            context[key] = source[key];
        }
    }
    return context;
}

/**
 * Wrap PDF bytes into a naturalized Encapsulated PDF dataset.
 *
 * The result carries `_meta` (Explicit VR Little Endian) and `_vrMap`
 * (EncapsulatedDocument pinned to OB) so the Part 10 writers can serialize
 * it directly. Every UID defaults to a freshly minted
 * `DicomMetaDictionary.uid()`; pass `StudyInstanceUID` (and optionally
 * `SeriesInstanceUID`) to attach the document into an existing study.
 *
 * Pass `options.sourceInstance` (a naturalized instance, or an array of them
 * from one study) to copy the Patient and General Study context off an
 * instance you already hold instead of retyping it. Precedence is
 * defaults < sourceInstance < explicit options; the document's own identity
 * is never inherited (see {@link copyContextFromInstance}).
 *
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {Object} [options] - naturalized keyword overrides (PatientName,
 *   PatientID, DocumentTitle, StudyInstanceUID, ...) plus `sourceInstance`
 * @returns {Object} naturalized dataset
 */
function encapsulatePdf(pdfBytes, options = {}) {
    const documentBytes = toExactArrayBuffer(pdfBytes);
    assertPdfMagic(documentBytes);

    const date = DicomMetaDictionary.date();
    const time = DicomMetaDictionary.time();

    // defaults < sourceInstance < explicit options. `inherited` only holds
    // context attributes present on the source, so `options.X || inherited.X
    // || default` picks an explicit option first, then the source, then the
    // builder default.
    const inherited = copyContextFromInstance(options.sourceInstance);

    const dataset = {
        // SOP Common
        SpecificCharacterSet: "ISO_IR 192",
        SOPClassUID: ENCAPSULATED_PDF_SOP_CLASS_UID,
        SOPInstanceUID: options.SOPInstanceUID || DicomMetaDictionary.uid(),

        // General Study (Type 2 attributes always present)
        StudyInstanceUID:
            options.StudyInstanceUID ||
            inherited.StudyInstanceUID ||
            DicomMetaDictionary.uid(),
        StudyDate: options.StudyDate || inherited.StudyDate || date,
        StudyTime: options.StudyTime || inherited.StudyTime || time,
        ReferringPhysicianName:
            options.ReferringPhysicianName ||
            inherited.ReferringPhysicianName ||
            "",
        StudyID: options.StudyID || inherited.StudyID || "",
        AccessionNumber:
            options.AccessionNumber || inherited.AccessionNumber || "",

        // Patient
        PatientName: options.PatientName || inherited.PatientName || "",
        PatientID: options.PatientID || inherited.PatientID || "",
        PatientBirthDate:
            options.PatientBirthDate || inherited.PatientBirthDate || "",
        PatientSex: options.PatientSex || inherited.PatientSex || "",

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
        // Review finding 16: the writer pads an odd-length OB value with a
        // NUL, so the stored length alone cannot say whether a trailing zero
        // byte is content or pad. (0042,0015) records the exact length so
        // extraction can slice instead of guessing.
        EncapsulatedDocumentLength: documentBytes.byteLength,
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
 * The Part 10 writer pads odd-length OB values with a trailing NUL. When
 * `EncapsulatedDocumentLength (0042,0015)` is present (encapsulatePdf always
 * writes it), the payload is sliced to that exact declared length, so an
 * even-length original that genuinely ends in a zero byte survives
 * (review finding 16). Only for files written without the element does the
 * old heuristic apply: a single trailing 0x00 on an even stored length is
 * trimmed as pad.
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

    let declaredLength = dataset.EncapsulatedDocumentLength;
    if (Array.isArray(declaredLength)) {
        declaredLength = declaredLength[0];
    }
    if (
        Number.isInteger(declaredLength) &&
        declaredLength >= 0 &&
        declaredLength <= bytes.byteLength
    ) {
        // Exact: slice to the declared original length.
        bytes = bytes.subarray(0, declaredLength);
    } else if (
        bytes.byteLength > 0 &&
        bytes.byteLength % 2 === 0 &&
        bytes[bytes.byteLength - 1] === 0x00
    ) {
        // Fallback for files without (0042,0015): treat a single trailing
        // NUL on an even stored length as the writer's pad byte.
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
