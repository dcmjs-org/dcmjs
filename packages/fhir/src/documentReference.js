// packages/fhir/src/documentReference.js
//
// FHIR R4B DocumentReference from a DICOM Encapsulated Document instance
// (Encapsulated PDF, SOP Class 1.2.840.10008.5.1.4.1.1.104.1) — the "PDF
// arrived via DICOM" mapping. Emits standard FHIR only — no ids, no
// meta.tags; id assignment is the consumer's job (same contract as
// patient.js / imagingStudy.js).
//
// DocumentReference.date is a FHIR instant, so it is written only when the
// dataset has ContentDate, ContentTime, and TimezoneOffsetFromUTC.

import { encodeBase64, toStringFirst } from "@dcmjs-org/core";
import {
    extractEncapsulated,
    ENCAPSULATED_PDF_SOP_CLASS_UID,
    PDF_MIME_TYPE
} from "@dcmjs-org/encapsulated";
import {
    dicomDateTimeToInstant,
    uidToUrn,
    DICOM_UID_SYSTEM
} from "./helpers.js";

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

    const code = toStringFirst(item.CodeValue);
    const meaning = toStringFirst(item.CodeMeaning);
    if (!code && !meaning) {
        return null;
    }

    const codeableConcept = {};
    if (code) {
        const designator = toStringFirst(item.CodingSchemeDesignator);
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

    const mimeType = toStringFirst(dataset.MIMETypeOfEncapsulatedDocument);
    const sopClassUid = toStringFirst(dataset.SOPClassUID);
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

    const date = dicomDateTimeToInstant(
        dataset.ContentDate,
        dataset.ContentTime,
        dataset.TimezoneOffsetFromUTC
    );
    if (date) {
        documentReference.date = date;
    }

    const title = toStringFirst(dataset.DocumentTitle);
    if (title) {
        documentReference.description = title;
    }

    const attachment = {
        contentType: mimeType || PDF_MIME_TYPE
    };
    if (title) {
        attachment.title = title;
    }
    // Review findings 8 (InlineBinary unwrap) and 16 (declared length).
    const bytes = extractEncapsulated(dataset);
    if (bytes) {
        attachment.size = bytes.byteLength;
        if (includeData) {
            attachment.data = encodeBase64(bytes);
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
