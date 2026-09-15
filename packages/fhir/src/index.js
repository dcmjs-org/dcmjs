// packages/fhir/src/index.js
//
// @dcmjs/fhir — FHIR both ways.
//
// The sink: naturalized DICOM Part 10 datasets
// (DicomMetaDictionary.naturalizeDataset output) → FHIR R4B resources.
// The source: a FHIR Patient → DICOM patient-module attributes
// (patientToDataset), for demographics injection.
//
// Deliberately simple: standard FHIR, nothing deployment-specific.
// Consumers assign resource ids, storage references, and meta.tags.
//
//   const { patient, imagingStudy, documentReference } = toFhir(dataset);
//   const bundle = toBundle([dataset1, dataset2]);
//   const attrs = patientToDataset(patientResource);  // → { PatientName, ... }

import { patientFromDataset } from "./patient.js";
import {
    imagingStudyFromDataset,
    imagingStudyFromDatasets
} from "./imagingStudy.js";
import { documentReferenceFromDataset } from "./documentReference.js";
import { assertSupportedFhirVersion } from "./helpers.js";

export * from "./helpers.js";
export { patientFromDataset } from "./patient.js";
export { patientToDataset } from "./patientToDataset.js";
export {
    imagingStudyFromDataset,
    imagingStudyFromDatasets
} from "./imagingStudy.js";
export { documentReferenceFromDataset } from "./documentReference.js";

/**
 * Map one naturalized dataset to its FHIR resources.
 *
 * Encapsulated document instances (e.g. Encapsulated PDF from a PACS) map
 * to a DocumentReference and no ImagingStudy; image instances map to an
 * ImagingStudy and no DocumentReference. The 3-key shape is stable either
 * way.
 * @param {Object} dataset - DicomMetaDictionary.naturalizeDataset output
 * @param {Object} [options]
 * @param {string} [options.fhirVersion='R4B'] - R4/R4B only; throws otherwise
 * @param {Object} [options.subject] - FHIR Reference for
 *   ImagingStudy.subject / DocumentReference.subject
 * @param {boolean} [options.includeData=true] - inline document bytes as
 *   base64 in DocumentReference attachments
 * @returns {{ patient: Object|null, imagingStudy: Object|null,
 *   documentReference: Object|null }}
 */
export function toFhir(dataset, options = {}) {
    assertSupportedFhirVersion(options);
    const documentReference = documentReferenceFromDataset(dataset, options);
    return {
        patient: patientFromDataset(dataset),
        imagingStudy: documentReference
            ? null
            : imagingStudyFromDataset(dataset, options),
        documentReference
    };
}

/**
 * Map one or more datasets (one study's worth of instances) to a FHIR
 * collection Bundle: at most one Patient (from the first dataset carrying
 * a patient module) and one aggregated ImagingStudy.
 * @param {Object[]} datasets - naturalized datasets
 * @param {Object} [options] - as toFhir
 * @returns {Object} FHIR Bundle (type: collection)
 */
export function toBundle(datasets, options = {}) {
    assertSupportedFhirVersion(options);

    const list = (datasets || []).filter(Boolean);
    const entries = [];

    let patient = null;
    for (const dataset of list) {
        patient = patientFromDataset(dataset);
        if (patient) {
            break;
        }
    }
    if (patient) {
        entries.push({ resource: patient });
    }

    // Encapsulated documents each become a DocumentReference; the
    // remaining (image) datasets aggregate into one ImagingStudy.
    const imageDatasets = [];
    for (const dataset of list) {
        const documentReference = documentReferenceFromDataset(
            dataset,
            options
        );
        if (documentReference) {
            entries.push({ resource: documentReference });
        } else {
            imageDatasets.push(dataset);
        }
    }

    const imagingStudy = imagingStudyFromDatasets(imageDatasets, options);
    if (imagingStudy) {
        entries.push({ resource: imagingStudy });
    }

    return {
        resourceType: "Bundle",
        type: "collection",
        total: entries.length,
        entry: entries
    };
}
