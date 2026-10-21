// src/eventStream/fromFhir.js
//
// FHIR resources as an event-stream SOURCE — for the resources that carry
// CONTENT, not just context. DocumentReference and Media can embed bytes
// inline (content.attachment.data, base64): an embedded PDF becomes an
// Encapsulated PDF instance, and an embedded JPEG (the key-image case)
// becomes an image instance with the JPEG bytes carried verbatim as
// encapsulated PixelData — JPEG is a DICOM transfer syntax, so no decode
// is needed, only the frame header.
//
// Context-only resources are rejected with corrective errors: a Patient
// carries identity, not content (pass it via options.patient instead), and
// an attachment holding only a url needs fetching first — network
// resolution belongs to the access layer, not the core library.
//
// This module is wrapper-level glue (the same home as api.js): it composes
// the encapsulated, imaging, fhir, and core packages, so it belongs to
// none of them — it moves into the step-7 wrapper package with the facade.

import { encapsulatePdf, PDF_MIME_TYPE } from "@dcmjs-org/encapsulated";
import { buildImageDataset, parseJpegInfo } from "@dcmjs-org/imaging";
import {
    base64ToArrayBuffer,
    patientTags,
    toStringFirst
} from "@dcmjs-org/core";
import { patientToDataset } from "@dcmjs-org/fhir";
import { datasetToDict } from "../datasetToBlob.js";

const CONTENT_TYPES = new Set(["DocumentReference", "Media"]);

function attachmentOf(resource) {
    if (resource.resourceType === "DocumentReference") {
        const entries = resource.content || [];
        return (
            entries.map(entry => entry?.attachment).find(a => a?.data) ||
            entries[0]?.attachment ||
            null
        );
    }
    // Media (R4/R4B): a single content attachment
    return resource.content || null;
}

/**
 * The Patient entries that a FHIR `reference` names. An exact `fullUrl`
 * match wins. Only a relative reference ("Patient/123", with an optional
 * "/_history/n") also matches by `id`; an absolute reference never matches
 * an entry of another server by `id` alone.
 */
function referencedEntries(reference, patientEntries) {
    const exact = patientEntries.filter(entry => entry.fullUrl === reference);
    if (exact.length > 0) {
        return exact;
    }
    const relative = reference.match(/^Patient\/([^/]+)(\/_history\/[^/]+)?$/);
    if (!relative) {
        return [];
    }
    return patientEntries.filter(entry => entry.resource.id === relative[1]);
}

/**
 * The Patient of the content resource in a Bundle. With a
 * `subject.reference`, the one Patient entry it references; else the only
 * Patient. A reference that matches no Patient or more than one, or more
 * than one Patient with no reference, throws, so the demographics never go
 * to the wrong patient (FHIR-USR-9). No Patient in the Bundle gives
 * undefined.
 */
function selectPatient(patientEntries, contentResource) {
    if (patientEntries.length === 0) {
        return undefined;
    }
    const reference = contentResource.subject?.reference;
    if (reference) {
        const matches = referencedEntries(reference, patientEntries);
        if (matches.length !== 1) {
            throw new Error(
                `fromFhir: the subject ${reference} of the ` +
                    `${contentResource.resourceType} matches ` +
                    `${matches.length === 0 ? "no" : matches.length} ` +
                    `Patients in the Bundle — pass the Patient as ` +
                    `options.patient`
            );
        }
        return matches[0].resource;
    }
    if (patientEntries.length > 1) {
        throw new Error(
            `fromFhir: the Bundle contains ${patientEntries.length} Patient ` +
                `resources and the ${contentResource.resourceType} has no ` +
                `subject reference — pass the Patient as options.patient`
        );
    }
    return patientEntries[0].resource;
}

/**
 * The patient overrides for a FHIR Patient (FHIR-USR-8). The Patient
 * replaces the whole patient module: the four mapped attributes, and an
 * `undefined` (removed) value for each other patient-level attribute of
 * `instance`. An `instance` with a different, non-empty PatientID throws,
 * because the new instance would join the study of another patient.
 */
function patientOverrides(patientResource, instance) {
    if (!patientResource) {
        return {};
    }
    const demographics = patientToDataset(patientResource);
    for (const sample of [].concat(instance ?? [])) {
        const instancePatientId = toStringFirst(sample?.PatientID);
        if (instancePatientId && instancePatientId !== demographics.PatientID) {
            throw new Error(
                `fromFhir: options.instance belongs to PatientID ` +
                    `${instancePatientId}, but the FHIR Patient has PatientID ` +
                    `"${demographics.PatientID}" — pass an instance of the ` +
                    `same patient, or no instance`
            );
        }
    }
    const cleared = Object.fromEntries(
        [...patientTags].map(keyword => [keyword, undefined])
    );
    return { ...cleared, ...demographics };
}

/**
 * Unwrap a Bundle into { contentResource, patientEntries }. The Patient is
 * selected later, because options.patient replaces the Bundle Patients.
 */
function selectFromBundle(bundle) {
    const entries = (bundle.entry || []).filter(entry => entry?.resource);
    const resources = entries.map(entry => entry.resource);
    const content = resources.filter(r => CONTENT_TYPES.has(r.resourceType));
    if (content.length === 0) {
        throw new Error(
            "fromFhir: the Bundle contains no content-carrying resource " +
                "(DocumentReference or Media with an inline attachment)"
        );
    }
    if (content.length > 1) {
        throw new Error(
            `fromFhir: the Bundle contains ${content.length} content-carrying ` +
                `resources — pass the one you want directly (an event stream ` +
                `is a single instance): ` +
                content.map(r => `${r.resourceType}/${r.id ?? "?"}`).join(", ")
        );
    }
    return {
        contentResource: content[0],
        patientEntries: entries.filter(
            entry => entry.resource.resourceType === "Patient"
        )
    };
}

const LOSSY_JPEG_TRANSFER_SYNTAXES = new Set([
    "1.2.840.10008.1.2.4.50",
    "1.2.840.10008.1.2.4.51"
]);

/**
 * The lossy compression attributes (PS3.3 C.7.6.1.1.5) for a JPEG that
 * uses a lossy process (baseline or extended); none for lossless.
 */
function lossyOverrides(info) {
    return LOSSY_JPEG_TRANSFER_SYNTAXES.has(info.transferSyntaxUID)
        ? {
              LossyImageCompression: "01",
              LossyImageCompressionMethod: "ISO_10918_1"
          }
        : {};
}

/**
 * Build a { meta, dict } dataset from a content-carrying FHIR resource.
 *
 * The options other than `patient` are the {@link createInstance} options of
 * `@dcmjs-org/core` (`instance`, `dataLevel`, `levels`, `predecessor`,
 * `postProcess`, `baseDicom`, `overrides`), and pass to encapsulatePdf or
 * buildImageDataset. The values that come from FHIR (the patient
 * demographics, and the DocumentTitle from the resource description or the
 * attachment title) go in front of `options.overrides`, so the caller
 * overrides win, and the FHIR values win over the base and inherited values.
 *
 * @example
 * dicomDictFromFhir(documentReference, {
 *     patient,
 *     instance: priorStudyInstance,
 *     overrides: { SeriesDescription: "Scanned reports" }
 * });
 *
 * @experimental Preliminary, with the fhir package (packages/fhir/README.md).
 * @param {Object} resource - DocumentReference | Media | Bundle
 * @param {Object} [options]
 * @param {Object} [options.patient] - FHIR Patient supplying demographics
 *   (replaces the Patients of a Bundle). In a Bundle without this option,
 *   the `subject` of the content resource selects the Patient; see
 *   selectPatient.
 * @returns {{ dicomDict: {meta: Object, dict: Object}, encapsulated: boolean }}
 */
export function dicomDictFromFhir(resource, options = {}) {
    if (!resource || typeof resource !== "object" || !resource.resourceType) {
        throw new Error("fromFhir: expected a FHIR resource object");
    }
    const { patient, overrides, ...instanceOptions } = options;

    let contentResource = resource;
    let patientResource = patient;
    if (resource.resourceType === "Bundle") {
        const selected = selectFromBundle(resource);
        contentResource = selected.contentResource;
        patientResource =
            patient || selectPatient(selected.patientEntries, contentResource);
    }

    if (contentResource.resourceType === "Patient") {
        throw new Error(
            "fromFhir: a Patient carries context, not content — pass it as " +
                "options.patient alongside a DocumentReference or Media, or " +
                "map it with fhir.patientToDataset()"
        );
    }
    if (!CONTENT_TYPES.has(contentResource.resourceType)) {
        throw new Error(
            `fromFhir: cannot source an instance from a ` +
                `${contentResource.resourceType} — content-carrying resources ` +
                `are DocumentReference and Media`
        );
    }

    const attachment = attachmentOf(contentResource);
    if (!attachment) {
        throw new Error(
            `fromFhir: ${contentResource.resourceType} has no content attachment`
        );
    }
    if (!attachment.data) {
        throw new Error(
            `fromFhir: the attachment carries a url (${attachment.url}) but ` +
                `no inline data — fetch the bytes first; network resolution ` +
                `belongs to the access layer, not the core library`
        );
    }

    const bytes = base64ToArrayBuffer(attachment.data);
    const contentType = (attachment.contentType || "").toLowerCase();
    const demographics = patientOverrides(
        patientResource,
        instanceOptions.instance
    );

    if (contentType === PDF_MIME_TYPE) {
        // No FHIR title keeps the base or inherited DocumentTitle.
        const title = contentResource.description || attachment.title;
        const dataset = encapsulatePdf(bytes, {
            ...instanceOptions,
            overrides: [
                title ? { DocumentTitle: title } : {},
                demographics,
                overrides
            ]
        });
        return { dicomDict: datasetToDict(dataset), encapsulated: false };
    }

    if (contentType === "image/jpeg" || contentType === "image/jpg") {
        const info = parseJpegInfo(new Uint8Array(bytes));
        if (!info.transferSyntaxUID) {
            throw new Error(
                "fromFhir: this JPEG flavor (SOF marker 0x" +
                    info.sofMarker.toString(16) +
                    ") has no DICOM transfer syntax — transcode to baseline " +
                    "JPEG first, or decode and use DicomEventStream.fromImage"
            );
        }
        if (!info.photometricInterpretation) {
            throw new Error(
                `fromFhir: a JPEG with ${info.samplesPerPixel} components ` +
                    `has no DICOM photometric interpretation — convert it to ` +
                    `RGB or greyscale JPEG first`
            );
        }
        const dataset = buildImageDataset(
            {
                rows: info.rows,
                columns: info.columns,
                samplesPerPixel: info.samplesPerPixel,
                bitsAllocated: info.bitsAllocated,
                bitsStored: info.bitsStored,
                pixelRepresentation: 0,
                planarConfiguration: 0,
                photometricInterpretation: info.photometricInterpretation
            },
            {
                ...instanceOptions,
                overrides: [lossyOverrides(info), demographics, overrides],
                encapsulated: {
                    transferSyntaxUID: info.transferSyntaxUID,
                    frames: [bytes]
                }
            }
        );
        const dicomDict = datasetToDict(dataset);
        if (dicomDict.dict["7FE00010"]) {
            dicomDict.dict["7FE00010"].encapsulatedPixelData = true;
        }
        return { dicomDict, encapsulated: true };
    }

    throw new Error(
        `fromFhir: no DICOM mapping for attachment contentType ` +
            `"${attachment.contentType}" — application/pdf and image/jpeg are ` +
            `supported inline; for other image formats decode the pixels and ` +
            `use DicomEventStream.fromImage`
    );
}
