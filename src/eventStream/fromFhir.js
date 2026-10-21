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
// the encapsulated, imaging, fhir, and parser packages, so it belongs to
// none of them — it moves into the step-7 wrapper package with the facade.

import { encapsulatePdf, PDF_MIME_TYPE } from "@dcmjs-org/encapsulated";
import { buildImageDataset, parseJpegInfo } from "@dcmjs-org/imaging";
import { base64ToArrayBuffer } from "@dcmjs-org/parser";
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

/** Unwrap a Bundle into { contentResource, patientResource }. */
function selectFromBundle(bundle) {
    const resources = (bundle.entry || [])
        .map(entry => entry?.resource)
        .filter(Boolean);
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
        patientResource: resources.find(r => r.resourceType === "Patient")
    };
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
 * @param {Object} resource - DocumentReference | Media | Bundle
 * @param {Object} [options]
 * @param {Object} [options.patient] - FHIR Patient supplying demographics
 *   (wins over a Patient found inside a Bundle)
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
        patientResource = patient || selected.patientResource;
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
    const demographics = patientResource
        ? patientToDataset(patientResource)
        : {};

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
        const dataset = buildImageDataset(
            {
                rows: info.rows,
                columns: info.columns,
                samplesPerPixel: info.samplesPerPixel,
                bitsAllocated: info.bitsAllocated,
                photometricInterpretation:
                    info.samplesPerPixel === 3 ? "YBR_FULL_422" : "MONOCHROME2"
            },
            {
                ...instanceOptions,
                overrides: [demographics, overrides],
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
