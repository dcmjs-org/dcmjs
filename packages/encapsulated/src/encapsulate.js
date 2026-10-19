// packages/encapsulated/src/encapsulate.js
//
// The generic Encapsulated Document builder. Wraps arbitrary bytes into a
// naturalized DICOM instance of an encapsulated-document IOD; the per-type
// wrappers (encapsulatePdf, and CDA/STL/... as they land) supply the base
// defaults and mime type.
//
// Assembly is a layered merge:
//
//   defaults  <  baseDicom  <  inherited context  <  explicit overrides
//
// then the document payload and encoding are pinned on top (they are never a
// caller's to get wrong). `defaults` mints fresh identity and dates and holds
// the always-present Type-2 empties; `baseDicom` is the per-type identity
// (SOP class, Modality, ...); `inherited` is the hierarchical context copied
// off a source instance; `overrides` is whatever the caller passed explicitly.
//
// NOTE (future): a fluent chaining form —
//   encapsulate(bytes).base(pdfBase()).inherit(instance, "study").set({...}).build()
// — is planned as an ergonomic layer on top of this flat options signature.
// Deferred for now; this flat form is the stable core.

import {
    DicomMetaDictionary,
    copyAttributesByLevel,
    EXPLICIT_LITTLE_ENDIAN
} from "@dcmjs-org/core";

// Identity that must never be inherited from a source instance: the
// encapsulated document is its own SOP instance, in its own new series, of
// its own document SOP class. Inheriting any of these would make the document
// impersonate the source. They are stripped from the inherited context before
// it is merged (explicit caller overrides are still honored).
const NON_INHERITABLE = [
    "SOPClassUID",
    "SOPInstanceUID",
    "SeriesInstanceUID",
    "Modality"
];

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
 * Build a naturalized Encapsulated Document dataset.
 *
 * @param {ArrayBuffer|Uint8Array} bytes - the document bytes to encapsulate
 * @param {Object} [options]
 * @param {Object} [options.baseDicom={}] - per-type identity/encoding defaults
 *   (e.g. from `pdfBase()`)
 * @param {string} [options.mimeType] - MIMETypeOfEncapsulatedDocument
 * @param {Object|Object[]} [options.instance] - naturalized source instance(s)
 *   to inherit Patient/Study/Series context from
 * @param {('patient'|'study'|'series'|'instance')} [options.dataLevel="study"]
 *   how far down the hierarchy to inherit from `instance`
 * @param {...*} [options.*] - any other naturalized keyword overrides (win)
 * @returns {Object} naturalized dataset, ready for the Part 10 writers
 */
export function encapsulate(bytes, options = {}) {
    const {
        baseDicom = {},
        mimeType,
        instance,
        dataLevel = "study",
        ...overrides
    } = options;

    const documentBytes = toExactArrayBuffer(bytes);
    const date = DicomMetaDictionary.date();
    const time = DicomMetaDictionary.time();

    const inherited = copyAttributesByLevel(instance, dataLevel);
    for (const key of NON_INHERITABLE) {
        delete inherited[key];
    }

    const dataset = {
        // Defaults: minted identity, today's dates, Type-2 empties.
        SpecificCharacterSet: "ISO_IR 192",
        SOPInstanceUID: DicomMetaDictionary.uid(),
        StudyInstanceUID: DicomMetaDictionary.uid(),
        SeriesInstanceUID: DicomMetaDictionary.uid(),
        SeriesNumber: 1,
        InstanceNumber: 1,
        StudyDate: date,
        StudyTime: time,
        ContentDate: date,
        ContentTime: time,
        AcquisitionDateTime: DicomMetaDictionary.dateTime(),
        ReferringPhysicianName: "",
        StudyID: "",
        AccessionNumber: "",
        PatientName: "",
        PatientID: "",
        PatientBirthDate: "",
        PatientSex: "",
        DocumentTitle: "",

        // Per-type identity + encoding seed.
        ...baseDicom,

        // Hierarchical context inherited from the source (identity stripped).
        ...inherited,

        // Explicit caller overrides win over everything above.
        ...overrides
    };

    // Document payload + encoding — pinned last, always authoritative.
    dataset.MIMETypeOfEncapsulatedDocument =
        mimeType ||
        baseDicom.MIMETypeOfEncapsulatedDocument ||
        dataset.MIMETypeOfEncapsulatedDocument;
    // Review finding 16: the writer pads an odd-length OB value with a NUL, so
    // the stored length alone cannot say whether a trailing zero byte is
    // content or pad. (0042,0015) records the exact length so extraction can
    // slice instead of guessing.
    dataset.EncapsulatedDocumentLength = documentBytes.byteLength;
    dataset.EncapsulatedDocument = documentBytes;
    dataset._meta = { TransferSyntaxUID: { Value: [EXPLICIT_LITTLE_ENDIAN] } };
    dataset._vrMap = { ...(dataset._vrMap || {}), EncapsulatedDocument: "OB" };

    return dataset;
}
