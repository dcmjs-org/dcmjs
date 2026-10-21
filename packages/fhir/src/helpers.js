// packages/fhir/src/helpers.js
//
// Shared DICOM → FHIR value mappers. Inputs are values from a NATURALIZED
// dcmjs dataset (DicomMetaDictionary.naturalizeDataset): keyword keys,
// single-value arrays collapsed to scalars, PN values as [{ Alphabetic }],
// IS values as numbers. Helpers are permissive about input shape
// (string / number / array / PN object) and strict about output — absent
// or unparseable inputs return null, never partial garbage.

import { MODALITY_DISPLAY, toStringFirst } from "@dcmjs-org/core";

export const DICOM_UID_SYSTEM = "urn:dicom:uid";
export const DICOM_MODALITY_SYSTEM =
    "http://dicom.nema.org/resources/ontology/DCM";

/**
 * Prefix a DICOM UID with urn:oid: for FHIR identifier/uid slots.
 */
export function uidToUrn(uid) {
    const clean = toStringFirst(uid);
    if (!clean) {
        return null;
    }
    return clean.startsWith("urn:oid:") ? clean : `urn:oid:${clean}`;
}

/**
 * DICOM DA (YYYYMMDD) + optional TM (HHMMSS.ffffff) → a FHIR dateTime.
 *
 * FHIR requires a timezone when a dateTime has a time. The time is written
 * only with a valid `timezoneOffset` (TimezoneOffsetFromUTC (0008,0201),
 * "+HHMM" or "-HHMM"); without it the result is the date only, which is
 * a valid dateTime that asserts no zone.
 */
export function dicomDateTimeToIso(dicomDate, dicomTime, timezoneOffset) {
    const date = toStringFirst(dicomDate);
    if (!date || date.length < 8) {
        return null;
    }

    let iso = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(
        6,
        8
    )}`;

    const time = toStringFirst(dicomTime);
    const offset = toStringFirst(timezoneOffset);
    if (time && time.length >= 6 && offset && /^[+-]\d{4}$/.test(offset)) {
        iso +=
            `T${time.substring(0, 2)}:${time.substring(2, 4)}:` +
            `${time.substring(4, 6)}${offset.substring(0, 3)}:` +
            offset.substring(3);
    }

    return iso;
}

/**
 * DICOM DA + TM + TimezoneOffsetFromUTC → a FHIR instant, or null when a
 * part is missing (an instant needs the full time and the zone).
 */
export function dicomDateTimeToInstant(dicomDate, dicomTime, timezoneOffset) {
    const iso = dicomDateTimeToIso(dicomDate, dicomTime, timezoneOffset);
    return iso && iso.includes("T") ? iso : null;
}

/**
 * Parse a DICOM person name into FHIR HumanName parts.
 * Accepts the naturalized PN shape ([{ Alphabetic: "Family^Given" }] or
 * { Alphabetic }) as well as a raw "Family^Given^Middle^Prefix^Suffix"
 * string.
 * @returns {Object|null} { family, given, middle, prefix, suffix, text }
 */
export function parsePersonName(pnValue) {
    let raw = pnValue;
    if (Array.isArray(raw)) {
        raw = raw.length > 0 ? raw[0] : null;
    }
    if (raw && typeof raw === "object" && "Alphabetic" in raw) {
        raw = raw.Alphabetic;
    }
    if (typeof raw !== "string" || raw.trim().length === 0) {
        return null;
    }

    const parts = raw.split("^");
    return {
        family: parts[0] || "",
        given: parts[1] || "",
        middle: parts[2] || "",
        prefix: parts[3] || "",
        suffix: parts[4] || "",
        text: parts.filter(part => part).join(" ")
    };
}

/**
 * Parsed person name → FHIR HumanName element (or null when empty).
 */
export function personNameToHumanName(parsed) {
    if (!parsed) {
        return null;
    }
    const humanName = {};
    if (parsed.family) {
        humanName.family = parsed.family;
    }
    const given = [parsed.given, parsed.middle].filter(Boolean);
    if (given.length > 0) {
        humanName.given = given;
    }
    if (parsed.prefix) {
        humanName.prefix = [parsed.prefix];
    }
    if (parsed.suffix) {
        humanName.suffix = [parsed.suffix];
    }
    if (parsed.text) {
        humanName.text = parsed.text;
    }
    return Object.keys(humanName).length > 0 ? humanName : null;
}

/**
 * DICOM PatientSex (M/F/O) → FHIR administrative gender.
 */
export function sexToGender(dicomSex) {
    const mapping = { M: "male", F: "female", O: "other" };
    return mapping[toStringFirst(dicomSex)] || "unknown";
}

/**
 * DICOM PatientSex → US Core birthsex code (M/F/UNK).
 */
export function sexToBirthSex(dicomSex) {
    const mapping = { M: "M", F: "F", O: "UNK" };
    return mapping[toStringFirst(dicomSex)] || "UNK";
}

/**
 * US Core birthsex extension for a DICOM PatientSex value.
 */
export function birthSexExtension(dicomSex) {
    if (!toStringFirst(dicomSex)) {
        return null;
    }
    return {
        url: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex",
        valueCode: sexToBirthSex(dicomSex)
    };
}

/**
 * US Core sex extension (sex-for-clinical-use) for a DICOM PatientSex value.
 */
export function sexExtension(dicomSex) {
    const sex = toStringFirst(dicomSex);
    if (!sex) {
        return null;
    }
    const mapping = {
        M: "male-typical",
        F: "female-typical",
        O: "specified"
    };
    return {
        url: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-sex",
        valueCodeableConcept: {
            coding: [
                {
                    system: "http://terminology.hl7.org/CodeSystem/sex-for-clinical-use",
                    code: mapping[sex] || "unknown",
                    display: mapping[sex] || "Unknown"
                }
            ]
        }
    };
}

/**
 * FHIR administrative gender → DICOM PatientSex (0010,0040).
 *
 * QUICKSAND, TREAD SLOWLY. FHIR `Patient.gender` is *administrative
 * gender*; DICOM PatientSex is a three-letter administrative repertoire
 * (M / F / O, Type 2 so empty is legal). These are not the same concept as
 * clinical sex or gender identity, and this mapping deliberately consults
 * ONLY `Patient.gender` — never US Core birthsex / sex-for-clinical-use
 * extensions, which carry different semantics and belong to profiles, not
 * the base resource. The mapping is lossy by design:
 *
 *   male    → M
 *   female  → F
 *   other   → O    (as does any unrecognized non-empty value — DICOM has
 *                   no better bucket, and inventing codes would be worse)
 *   unknown → ""   (DICOM PatientSex is Type 2: present-but-empty is the
 *                   standard way to say "not known")
 *   absent/blank → ""
 *
 * Mirrors sexToGender above, so M/F/O round-trip exactly and empty ⇄
 * unknown round-trips to empty.
 */
export function genderToSex(gender) {
    const value = toStringFirst(gender);
    if (!value) {
        return "";
    }
    const normalized = value.toLowerCase();
    if (normalized === "male") {
        return "M";
    }
    if (normalized === "female") {
        return "F";
    }
    if (normalized === "unknown") {
        return "";
    }
    return "O";
}

/**
 * FHIR HumanName → DICOM PN string ("Family^Given^Middle^Prefix^Suffix").
 * Inverse of parsePersonName/personNameToHumanName: given[0] is the given
 * name, given[1] the middle; only the first prefix/suffix survive (PN has
 * one slot each). Trailing empty components are trimmed per PN convention.
 *
 * When the name carries no structured parts at all, `HumanName.text`
 * (when present) survives as a single-component PN rather than returning
 * null — a text-only name must not erase an existing PatientName under
 * patientToDataset's deterministic overwrite (review finding 19). The
 * text is used whole; guessing a "Family, Given" split from free text
 * would fabricate structure the resource never asserted.
 * @returns {string|null} null when the name carries no usable parts
 */
export function humanNameToPersonName(humanName) {
    if (!humanName || typeof humanName !== "object") {
        return null;
    }
    const given = Array.isArray(humanName.given) ? humanName.given : [];
    const components = [
        toStringFirst(humanName.family) || "",
        toStringFirst(given[0]) || "",
        toStringFirst(given[1]) || "",
        toStringFirst(
            Array.isArray(humanName.prefix) ? humanName.prefix[0] : null
        ) || "",
        toStringFirst(
            Array.isArray(humanName.suffix) ? humanName.suffix[0] : null
        ) || ""
    ];
    while (components.length && components[components.length - 1] === "") {
        components.pop();
    }
    const pn = components.join("^");
    if (pn.length > 0) {
        return pn;
    }
    // No structured parts: fall back to the free-text form, if any.
    return toStringFirst(humanName.text);
}

/**
 * FHIR date (ISO 8601) → DICOM DA (YYYYMMDD). Inverse of
 * dicomDateTimeToIso for the date part. FHIR allows partial dates (YYYY,
 * YYYY-MM); DICOM DA does not — partial dates return null rather than a
 * fabricated day.
 */
export function isoDateToDicom(isoDate) {
    const value = toStringFirst(isoDate);
    if (!value) {
        return null;
    }
    if (/^\d{8}$/.test(value)) {
        return value;
    }
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

/**
 * FHIR Coding for a DICOM modality code.
 */
export function modalityCoding(modalityCode) {
    const code = toStringFirst(modalityCode);
    if (!code) {
        return null;
    }
    return {
        system: DICOM_MODALITY_SYSTEM,
        code,
        display: MODALITY_DISPLAY[code] || code
    };
}

/**
 * Guard: only R4B is implemented. Throws on anything else so callers
 * never silently receive the wrong flavor of JSON.
 */
export function assertSupportedFhirVersion(options = {}) {
    const version = options.fhirVersion || "R4B";
    if (version !== "R4B" && version !== "R4") {
        throw new Error(
            `@dcmjs/fhir: unsupported fhirVersion "${version}" (supported: R4, R4B)`
        );
    }
    return version;
}
