// packages/fhir/src/imagingStudy.js
//
// FHIR R4B ImagingStudy from naturalized DICOM dataset(s). The DICOM
// study/series/instance hierarchy maps directly onto
// ImagingStudy.series[].instance[] — this is deliberately a thin
// restatement of the Part 10 elements as FHIR-flavored JSON.
// Based on the IHE Radiology Technical Framework (MADO) mapping.

import {
    DICOM_UID_SYSTEM,
    asString,
    asNumber,
    uidToUrn,
    dicomDateTimeToIso,
    parsePersonName,
    modalityCoding
} from "./helpers.js";

function instanceFromDataset(dataset) {
    const sopInstanceUid = asString(dataset.SOPInstanceUID);
    if (!sopInstanceUid) {
        return null;
    }

    const instance = {
        uid: sopInstanceUid,
        sopClass: {
            system: "urn:ietf:rfc:3986",
            code:
                uidToUrn(dataset.SOPClassUID) ||
                "urn:oid:1.2.840.10008.5.1.4.1.1.2"
        }
    };

    const number = asNumber(dataset.InstanceNumber);
    if (number !== null) {
        instance.number = number;
    }
    const numberOfFrames = asNumber(dataset.NumberOfFrames);
    if (numberOfFrames !== null) {
        instance.numberOfFrames = numberOfFrames;
    }
    const title =
        asString(dataset.SeriesDescription) ||
        asString(dataset.StudyDescription);
    if (title) {
        instance.title = title;
    }

    return instance;
}

function seriesShellFromDataset(dataset) {
    const series = {
        uid: asString(dataset.SeriesInstanceUID) || null,
        instance: []
    };

    const number = asNumber(dataset.SeriesNumber);
    if (number !== null) {
        series.number = number;
    }
    const modality = modalityCoding(dataset.Modality);
    if (modality) {
        series.modality = modality;
    }
    const description = asString(dataset.SeriesDescription);
    if (description) {
        series.description = description;
    }
    const started = dicomDateTimeToIso(dataset.SeriesDate, dataset.SeriesTime);
    if (started) {
        series.started = started;
    }
    const bodyPart = asString(dataset.BodyPartExamined);
    if (bodyPart) {
        series.bodySite = {
            system: "http://snomed.info/sct",
            display: bodyPart
        };
    }
    const laterality = asString(dataset.Laterality);
    if (laterality) {
        series.laterality = {
            system: "http://snomed.info/sct",
            display: laterality
        };
    }

    return series;
}

/**
 * Build one FHIR ImagingStudy from one or more naturalized datasets
 * belonging to the same study. Instances are grouped by
 * SeriesInstanceUID; the first dataset anchors study-level identity.
 *
 * @param {Object[]} datasets - naturalized datasets (same StudyInstanceUID)
 * @param {Object} [options]
 * @param {Object} [options.subject] - FHIR Reference ({ reference, display })
 *   to attach as ImagingStudy.subject — generic FHIR, supplied by the caller
 * @returns {Object|null} FHIR ImagingStudy, or null for empty input
 */
export function imagingStudyFromDatasets(datasets, options = {}) {
    const list = (datasets || []).filter(Boolean);
    if (list.length === 0) {
        return null;
    }

    const first = list[0];

    // No imaging identity at all → not a study
    const hasIdentity = list.some(
        dataset =>
            asString(dataset.StudyInstanceUID) ||
            asString(dataset.SeriesInstanceUID) ||
            asString(dataset.SOPInstanceUID)
    );
    if (!hasIdentity) {
        return null;
    }

    // Group instances by series
    const seriesMap = new Map();
    list.forEach(dataset => {
        const seriesUid = asString(dataset.SeriesInstanceUID) || "unknown";
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
    const studyUid = asString(first.StudyInstanceUID);
    if (studyUid) {
        identifiers.push({
            use: "official",
            system: DICOM_UID_SYSTEM,
            value: uidToUrn(studyUid)
        });
    }
    const accessionNumber = asString(first.AccessionNumber);
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

    const started = dicomDateTimeToIso(first.StudyDate, first.StudyTime);
    if (started) {
        study.started = started;
    }
    const description = asString(first.StudyDescription);
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
