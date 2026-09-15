// packages/fhir/src/patientToDataset.js
//
// The FHIR source direction: a FHIR Patient resource → DICOM patient-module
// attributes (group 0010) in naturalized keyword form. Inverse of
// patient.js's patientFromDataset, and the primitive behind demographics
// injection ("apply this Patient to these instances").
//
// Contract: the result ALWAYS carries all four keys — PatientName,
// PatientID, PatientBirthDate, PatientSex — with "" for anything the
// resource doesn't provide. Deterministic overwrite is the point: applying
// a Patient must replace the whole patient module, not leave stale values
// from the previous identity behind. Callers that want merge-not-replace
// can filter the empties themselves.

import { genderToSex, humanNameToPersonName, isoDateToDicom } from "./helpers.js";

const MR_IDENTIFIER_CODE = "MR";

/**
 * Pick the name to use: `official` wins, then `usual`, then the first
 * entry with no `use` at all, then the first entry — so a resource
 * carrying both a married (official) and maiden name maps to the married
 * one, never the maiden.
 */
function selectName(names) {
    if (!Array.isArray(names) || names.length === 0) {
        return null;
    }
    for (const use of ["official", "usual"]) {
        const match = names.find(name => name && name.use === use);
        if (match) {
            return match;
        }
    }
    return names.find(name => name && !name.use) || names[0];
}

/**
 * Pick the identifier for PatientID: an MR-typed identifier wins
 * (type.coding code "MR", the shape patientFromDataset emits), else the
 * first identifier carrying a value.
 */
function selectIdentifier(identifiers) {
    if (!Array.isArray(identifiers) || identifiers.length === 0) {
        return null;
    }
    const mrTyped = identifiers.find(identifier =>
        identifier?.type?.coding?.some(
            coding => coding && coding.code === MR_IDENTIFIER_CODE
        )
    );
    return mrTyped || identifiers.find(identifier => identifier?.value) || null;
}

/**
 * Map a FHIR Patient resource to DICOM patient-module attributes.
 *
 * @param {Object} patient - FHIR Patient (R4/R4B)
 * @returns {{ PatientName: string, PatientID: string,
 *   PatientBirthDate: string, PatientSex: string }} naturalized keyword
 *   attributes; absent resource fields are "" (deterministic overwrite)
 * @throws when the input is not a Patient resource
 */
export function patientToDataset(patient) {
    if (!patient || patient.resourceType !== "Patient") {
        throw new Error(
            "patientToDataset expects a FHIR Patient resource " +
                `(got resourceType "${patient?.resourceType}")`
        );
    }

    const name = selectName(patient.name);
    const identifier = selectIdentifier(patient.identifier);

    return {
        PatientName: (name && humanNameToPersonName(name)) || "",
        PatientID: identifier?.value || "",
        PatientBirthDate: isoDateToDicom(patient.birthDate) || "",
        PatientSex: genderToSex(patient.gender)
    };
}
