// packages/fhir/src/index.js
//
// @dcmjs-org/fhir — FHIR both ways.
//
// PRELIMINARY API: the exports can change in a minor release while
// packages/fhir/README.md has the preliminary notice.
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

import { toStringFirst, validationLog } from "@dcmjs-org/core";
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
 *
 * Without `options.subject`, the ImagingStudy or DocumentReference
 * references the Patient of the result as `{ reference: "./patient" }`, a
 * path relative to the returned object (FHIR-USR-10). The consumer replaces
 * it when it stores the resources.
 *
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
    const patient = patientFromDataset(dataset);
    const resourceOptions = withSubject(options, patient && "./patient");
    const documentReference = documentReferenceFromDataset(
        dataset,
        resourceOptions
    );
    return {
        patient,
        imagingStudy: documentReference
            ? null
            : imagingStudyFromDataset(dataset, resourceOptions),
        documentReference
    };
}

/** The options with a relative `subject`, unless the caller gave one. */
function withSubject(options, reference) {
    if (options.subject || !reference) {
        return options;
    }
    return { ...options, subject: { reference } };
}

/**
 * Map one or more datasets (one study's worth of instances) to a FHIR
 * collection Bundle: at most one Patient, a DocumentReference for each
 * encapsulated document, and one aggregated ImagingStudy.
 *
 * The first dataset with a patient module gives the Patient, and the first
 * dataset with a StudyInstanceUID gives the study. A dataset with a
 * different PatientID or StudyInstanceUID is skipped with a validationLog
 * warning (FHIR-USR-3). Each entry has `fullUrl: "./entry/<index>"`, a path
 * relative to the returned Bundle, and without `options.subject` the
 * ImagingStudy and the DocumentReferences reference the Patient by its
 * `fullUrl` (FHIR-USR-10).
 *
 * @param {Object[]} datasets - naturalized datasets
 * @param {Object} [options] - as toFhir
 * @returns {Object} FHIR Bundle (type: collection)
 */
export function toBundle(datasets, options = {}) {
    assertSupportedFhirVersion(options);

    const all = (datasets || []).filter(Boolean);
    const resources = [];

    let patient = null;
    let patientId = null;
    for (const dataset of all) {
        patient = patientFromDataset(dataset);
        if (patient) {
            patientId = toStringFirst(dataset.PatientID);
            break;
        }
    }
    const studyUid = all
        .map(dataset => toStringFirst(dataset.StudyInstanceUID))
        .find(Boolean);
    const list = all.filter(dataset =>
        sameContext(dataset, patientId, studyUid)
    );
    if (patient) {
        resources.push(patient);
    }
    const resourceOptions = withSubject(options, patient && "./entry/0");

    // Encapsulated documents each become a DocumentReference; the
    // remaining (image) datasets aggregate into one ImagingStudy.
    const imageDatasets = [];
    for (const dataset of list) {
        const documentReference = documentReferenceFromDataset(
            dataset,
            resourceOptions
        );
        if (documentReference) {
            resources.push(documentReference);
        } else {
            imageDatasets.push(dataset);
        }
    }

    const imagingStudy = imagingStudyFromDatasets(
        imageDatasets,
        resourceOptions
    );
    if (imagingStudy) {
        resources.push(imagingStudy);
    }

    return {
        resourceType: "Bundle",
        type: "collection",
        total: resources.length,
        entry: resources.map((resource, index) => ({
            fullUrl: `./entry/${index}`,
            resource
        }))
    };
}

/** True when the dataset belongs to the patient and study of the Bundle. */
function sameContext(dataset, patientId, studyUid) {
    const datasetPatientId = toStringFirst(dataset.PatientID);
    const datasetStudyUid = toStringFirst(dataset.StudyInstanceUID);
    const reason =
        patientId && datasetPatientId && datasetPatientId !== patientId
            ? `PatientID ${datasetPatientId} is not ${patientId}`
            : studyUid && datasetStudyUid && datasetStudyUid !== studyUid
            ? `StudyInstanceUID ${datasetStudyUid} is not ${studyUid}`
            : null;
    if (reason) {
        validationLog.warn(
            "@dcmjs-org/fhir: toBundle skips dataset " +
                `${
                    toStringFirst(dataset.SOPInstanceUID) ||
                    "<no SOPInstanceUID>"
                } — ${reason}`
        );
        return false;
    }
    return true;
}
