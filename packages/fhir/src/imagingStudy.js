// packages/fhir/src/imagingStudy.js
//
// FHIR R4B ImagingStudy from naturalized DICOM dataset(s). The DICOM
// study/series/instance hierarchy maps directly onto
// ImagingStudy.series[].instance[] — this is deliberately a thin
// restatement of the Part 10 elements as FHIR-flavored JSON.
// Based on the IHE Radiology Technical Framework (MADO) mapping.

import { validationLog, toStringFirst, toFloatFirst } from "@dcmjs-org/core";

import {
    DICOM_UID_SYSTEM,
    uidToUrn,
    dicomDateTimeToIso,
    parsePersonName,
    modalityCoding
} from "./helpers.js";

function instanceFromDataset(dataset) {
    const sopInstanceUid = toStringFirst(dataset.SOPInstanceUID);
    if (!sopInstanceUid) {
        return null;
    }

    const sopClassUrn = uidToUrn(dataset.SOPClassUID);
    if (!sopClassUrn) {
        validationLog.warn(
            `@dcmjs-org/fhir: skipping instance ${sopInstanceUid} — ` +
                "no SOPClassUID (instance.sopClass is required 1..1)"
        );
        return null;
    }

    const instance = {
        uid: sopInstanceUid,
        sopClass: {
            system: "urn:ietf:rfc:3986",
            code: sopClassUrn
        }
    };

    const number = unsignedIntFirst(dataset.InstanceNumber);
    if (number !== null) {
        instance.number = number;
    }
    const numberOfFrames = unsignedIntFirst(dataset.NumberOfFrames);
    if (numberOfFrames !== null) {
        instance.numberOfFrames = numberOfFrames;
    }
    const title =
        toStringFirst(dataset.SeriesDescription) ||
        toStringFirst(dataset.StudyDescription);
    if (title) {
        instance.title = title;
    }

    return instance;
}

function seriesShellFromDataset(dataset) {
    const series = {
        uid: toStringFirst(dataset.SeriesInstanceUID),
        instance: []
    };

    const number = unsignedIntFirst(dataset.SeriesNumber);
    if (number !== null) {
        series.number = number;
    }
    // The caller skips a dataset with no Modality (series.modality is 1..1).
    series.modality = modalityCoding(dataset.Modality);
    const description = toStringFirst(dataset.SeriesDescription);
    if (description) {
        series.description = description;
    }
    const started = dicomDateTimeToIso(
        dataset.SeriesDate,
        dataset.SeriesTime,
        dataset.TimezoneOffsetFromUTC
    );
    if (started) {
        series.started = started;
    }
    // A DICOM defined term is not a SNOMED display, so it has no system.
    const bodyPart = toStringFirst(dataset.BodyPartExamined);
    if (bodyPart) {
        series.bodySite = { display: bodyPart };
    }
    const laterality = toStringFirst(dataset.Laterality);
    if (laterality) {
        series.laterality = LATERALITY_CODING[laterality] || {
            display: laterality
        };
    }

    return series;
}

/** DICOM Laterality (0020,0060) → SNOMED CT (PS3.16 CID 244). */
const LATERALITY_CODING = {
    L: { system: "http://snomed.info/sct", code: "7771000", display: "Left" },
    R: { system: "http://snomed.info/sct", code: "24028007", display: "Right" },
    B: {
        system: "http://snomed.info/sct",
        code: "51440002",
        display: "Right and left"
    }
};

function warnSkip(dataset, reason) {
    validationLog.warn(
        "@dcmjs-org/fhir: skipping dataset " +
            `${
                toStringFirst(dataset.SOPInstanceUID) || "<no SOPInstanceUID>"
            } — ${reason}`
    );
}

/** The first value as a FHIR unsignedInt, or null. */
function unsignedIntFirst(value) {
    const number = toFloatFirst(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
}

/**
 * Build one FHIR ImagingStudy from one or more naturalized datasets
 * belonging to the same study. Instances are grouped by
 * SeriesInstanceUID. The first dataset with a StudyInstanceUID anchors the
 * study-level identity.
 *
 * The mapper never fabricates a value that FHIR requires (FHIR-USR-3). It
 * skips, with a validationLog warning: a dataset of another study, a
 * dataset with no SeriesInstanceUID or no Modality (series.uid and
 * series.modality are 1..1), and an instance with no SOPClassUID
 * (instance.sopClass is 1..1).
 *
 * @param {Object[]} datasets - naturalized datasets (same StudyInstanceUID)
 * @param {Object} [options]
 * @param {Object} [options.subject] - FHIR Reference ({ reference, display })
 *   to attach as ImagingStudy.subject — generic FHIR, supplied by the caller
 * @returns {Object|null} FHIR ImagingStudy, or null for empty input
 */
export function imagingStudyFromDatasets(datasets, options = {}) {
    const all = (datasets || []).filter(Boolean);
    if (all.length === 0) {
        return null;
    }

    const first =
        all.find(dataset => toStringFirst(dataset.StudyInstanceUID)) || all[0];
    const anchorStudyUid = toStringFirst(first.StudyInstanceUID);
    const list = all.filter(dataset => {
        const studyUid = toStringFirst(dataset.StudyInstanceUID);
        if (studyUid && studyUid !== anchorStudyUid) {
            warnSkip(
                dataset,
                `StudyInstanceUID ${studyUid} is not the study ` +
                    `${anchorStudyUid} of this ImagingStudy`
            );
            return false;
        }
        return true;
    });

    // No imaging identity at all → not a study
    const hasIdentity = list.some(
        dataset =>
            toStringFirst(dataset.StudyInstanceUID) ||
            toStringFirst(dataset.SeriesInstanceUID) ||
            toStringFirst(dataset.SOPInstanceUID)
    );
    if (!hasIdentity) {
        return null;
    }

    const seriesMap = new Map();
    list.forEach(dataset => {
        const seriesUid = toStringFirst(dataset.SeriesInstanceUID);
        if (!seriesUid) {
            warnSkip(dataset, "no SeriesInstanceUID (series.uid is 1..1)");
            return;
        }
        if (!toStringFirst(dataset.Modality)) {
            warnSkip(dataset, "no Modality (series.modality is 1..1)");
            return;
        }
        if (!seriesMap.has(seriesUid)) {
            seriesMap.set(seriesUid, seriesShellFromDataset(dataset));
        }
        const instance = instanceFromDataset(dataset);
        if (instance) {
            seriesMap.get(seriesUid).instance.push(instance);
        }
    });

    const series = Array.from(seriesMap.values()).map(shell => {
        const entry = { ...shell };
        entry.numberOfInstances = entry.instance.length;
        if (entry.instance.length === 0) {
            delete entry.instance;
        }
        return entry;
    });

    const numberOfInstances = series.reduce(
        (sum, entry) => sum + (entry.numberOfInstances || 0),
        0
    );

    const study = {
        resourceType: "ImagingStudy",
        status: "available",
        numberOfSeries: series.length,
        numberOfInstances,
        series
    };

    const identifiers = [];
    const studyUid = toStringFirst(first.StudyInstanceUID);
    if (studyUid) {
        identifiers.push({
            use: "official",
            system: DICOM_UID_SYSTEM,
            value: uidToUrn(studyUid)
        });
    }
    const accessionNumber = toStringFirst(first.AccessionNumber);
    if (accessionNumber) {
        identifiers.push({
            use: "usual",
            type: {
                coding: [
                    {
                        system: "http://terminology.hl7.org/CodeSystem/v2-0203",
                        code: "ACSN"
                    }
                ]
            },
            value: accessionNumber
        });
    }
    if (identifiers.length > 0) {
        study.identifier = identifiers;
    }

    const started = dicomDateTimeToIso(
        first.StudyDate,
        first.StudyTime,
        first.TimezoneOffsetFromUTC
    );
    if (started) {
        study.started = started;
    }
    const description = toStringFirst(first.StudyDescription);
    if (description) {
        study.description = description;
    }
    const referrer = parsePersonName(first.ReferringPhysicianName);
    if (referrer && referrer.text) {
        study.referrer = { display: referrer.text };
    }
    if (options.subject && options.subject.reference) {
        study.subject = options.subject;
    }

    // Study-level modality union (distinct series modalities)
    const modalities = [];
    series.forEach(entry => {
        if (
            entry.modality &&
            !modalities.some(m => m.code === entry.modality.code)
        ) {
            modalities.push(entry.modality);
        }
    });
    if (modalities.length > 0) {
        study.modality = modalities;
    }

    return study;
}

/**
 * Single-dataset convenience wrapper.
 */
export function imagingStudyFromDataset(dataset, options = {}) {
    return imagingStudyFromDatasets(dataset ? [dataset] : [], options);
}
