// packages/fhir/src/patient.js
//
// FHIR R4B Patient from the DICOM patient module (group 0010) of a
// naturalized dataset. Emits standard FHIR only — no ids, no meta.tags,
// no storage references. Id assignment and any deployment-specific
// decoration are the consumer's job.

import {
    asString,
    dicomDateTimeToIso,
    parsePersonName,
    personNameToHumanName,
    sexToGender,
    birthSexExtension,
    sexExtension
} from "./helpers.js";

/**
 * Build a FHIR Patient resource from a naturalized DICOM dataset.
 * @param {Object} dataset - DicomMetaDictionary.naturalizeDataset output
 * @returns {Object|null} FHIR Patient, or null when the dataset carries
 *   no usable patient module (no PatientName and no PatientID)
 */
export function patientFromDataset(dataset) {
    if (!dataset) {
        return null;
    }

    const patientId = asString(dataset.PatientID);
    const humanName = personNameToHumanName(
        parsePersonName(dataset.PatientName)
    );

    if (!patientId && !humanName) {
        return null;
    }

    const patient = {
        resourceType: "Patient"
    };

    if (patientId) {
        patient.identifier = [
            {
                use: "usual",
                type: {
                    coding: [
                        {
                            system: "http://terminology.hl7.org/CodeSystem/v2-0203",
                            code: "MR",
                            display: "Medical Record Number"
                        }
                    ],
                    text: "Medical Record Number"
                },
                value: patientId
            }
        ];
    }

    if (humanName) {
        patient.name = [humanName];
    }

    const birthDate = dicomDateTimeToIso(dataset.PatientBirthDate);
    if (birthDate) {
        patient.birthDate = birthDate;
    }

    const dicomSex = asString(dataset.PatientSex);
    patient.gender = sexToGender(dicomSex);

    const extensions = [
        birthSexExtension(dicomSex),
        sexExtension(dicomSex)
    ].filter(Boolean);
    if (extensions.length > 0) {
        patient.extension = extensions;
    }

    return patient;
}
