// packages/fhir/src/documentReference.js
//
// FHIR R4B DocumentReference from a DICOM Encapsulated Document instance
// (Encapsulated PDF, SOP Class 1.2.840.10008.5.1.4.1.1.104.1) — the "PDF
// arrived via DICOM" mapping. Emits standard FHIR only — no ids, no
// meta.tags; id assignment is the consumer's job (same contract as
// patient.js / imagingStudy.js).
//
// Known limitation: DocumentReference.date is a FHIR instant (timezone
// required) but DICOM ContentDate/ContentTime carry no zone; the ISO string
// is emitted as-is, matching this package's dicomDateTimeToIso pragmatism.

import {
    asString,
    bytesToBase64,
    dicomDateTimeToIso,
    uidToUrn,
    DICOM_UID_SYSTEM
} from "./helpers.js";

const ENCAPSULATED_PDF_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.104.1";
const PDF_MIME_TYPE = "application/pdf";

const CODING_SCHEME_SYSTEMS = {
    LN: "http://loinc.org",
    DCM: "http://dicom.nema.org/resources/ontology/DCM",
    SCT: "http://snomed.info/sct",
    SRT: "http://snomed.info/sct"
};

/**
 * Naturalized ConceptNameCodeSequence (item object, array of items, or
 * addAccessors proxy) → FHIR CodeableConcept, or null.
 */
function conceptNameToCodeableConcept(conceptName) {
    let item = conceptName;
    if (Array.isArray(item)) {
        item = item.length > 0 ? item[0] : null;
    }
    if (!item || typeof item !== "object") {
        return null;
    }

    const code = asString(item.CodeValue);
    const meaning = asString(item.CodeMeaning);
    if (!code && !meaning) {
        return null;
    }

    const codeableConcept = {};
    if (code) {
        const designator = asString(item.CodingSchemeDesignator);
        const coding = { code };
        if (designator) {
            coding.system = CODING_SCHEME_SYSTEMS[designator] || designator;
        }
        if (meaning) {
            coding.display = meaning;
        }
        codeableConcept.coding = [coding];
    }
    if (meaning) {
        codeableConcept.text = meaning;
    }
    return codeableConcept;
}

/**
 * Extract the encapsulated payload as bytes, trimming the single trailing
 * NUL the Part 10 writer adds to odd-length OB values.
 */
function payloadBytes(encapsulatedDocument) {
    let payload = encapsulatedDocument;
    if (Array.isArray(payload)) {
        payload = payload.length > 0 ? payload[0] : null;
    }
    if (payload === null || payload === undefined) {
        return null;
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
    return bytes;
}

/**
 * Build a FHIR DocumentReference from a naturalized Encapsulated Document
 * dataset.
 * @param {Object} dataset - DicomMetaDictionary.naturalizeDataset output
 * @param {Object} [options]
 * @param {Object} [options.subject] - FHIR Reference for .subject
 * @param {boolean} [options.includeData=true] - inline the document as
 *   base64 in content[0].attachment.data (size is always emitted)
 * @returns {Object|null} FHIR DocumentReference, or null when the dataset
 *   is not an encapsulated document instance
 */
export function documentReferenceFromDataset(dataset, options = {}) {
    if (!dataset) {
        return null;
    }

    const mimeType = asString(dataset.MIMETypeOfEncapsulatedDocument);
    const sopClassUid = asString(dataset.SOPClassUID);
    const isEncapsulated =
        mimeType !== null || sopClassUid === ENCAPSULATED_PDF_SOP_CLASS_UID;
    if (!isEncapsulated || dataset.EncapsulatedDocument === undefined) {
        return null;
    }

    const includeData = options.includeData !== false;
    const documentReference = {
        resourceType: "DocumentReference",
        status: "current"
    };

    const sopInstanceUrn = uidToUrn(dataset.SOPInstanceUID);
    if (sopInstanceUrn) {
        documentReference.masterIdentifier = {
            system: DICOM_UID_SYSTEM,
            value: sopInstanceUrn
        };
    }

    const type = conceptNameToCodeableConcept(dataset.ConceptNameCodeSequence);
    if (type) {
        documentReference.type = type;
    }

    if (options.subject) {
        documentReference.subject = options.subject;
    }

    const date = dicomDateTimeToIso(dataset.ContentDate, dataset.ContentTime);
    if (date) {
        documentReference.date = date;
    }

    const title = asString(dataset.DocumentTitle);
    if (title) {
        documentReference.description = title;
    }

    const attachment = {
        contentType: mimeType || PDF_MIME_TYPE
    };
    if (title) {
        attachment.title = title;
    }
    const bytes = payloadBytes(dataset.EncapsulatedDocument);
    if (bytes) {
        attachment.size = bytes.byteLength;
        if (includeData) {
            attachment.data = bytesToBase64(bytes);
        }
    }
    documentReference.content = [{ attachment }];

    const studyUrn = uidToUrn(dataset.StudyInstanceUID);
    if (studyUrn) {
        documentReference.context = {
            related: [
                {
                    identifier: {
                        system: DICOM_UID_SYSTEM,
                        value: studyUrn
                    }
                }
            ]
        };
    }

    return documentReference;
}
