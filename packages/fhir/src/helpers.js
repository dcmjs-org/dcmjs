// packages/fhir/src/helpers.js
//
// Shared DICOM → FHIR value mappers. Inputs are values from a NATURALIZED
// dcmjs dataset (DicomMetaDictionary.naturalizeDataset): keyword keys,
// single-value arrays collapsed to scalars, PN values as [{ Alphabetic }],
// IS values as numbers. Helpers are permissive about input shape
// (string / number / array / PN object) and strict about output — absent
// or unparseable inputs return null, never partial garbage.

export const DICOM_UID_SYSTEM = "urn:dicom:uid";
export const DICOM_MODALITY_SYSTEM =
    "http://dicom.nema.org/resources/ontology/DCM";

/**
 * DICOM Modality code → display name.
 * System: http://dicom.nema.org/resources/ontology/DCM
 */
export const MODALITY_DISPLAY = {
    AR: "Autorefraction",
    AU: "Audio",
    BDUS: "Bone Densitometry (Ultrasound)",
    BI: "Biomagnetic Imaging",
    BMD: "Bone Densitometry (X-Ray)",
    CR: "Computed Radiography",
    CT: "Computed Tomography",
    DG: "Diaphanography",
    DOC: "Document",
    DX: "Digital Radiography",
    ECG: "Electrocardiography",
    EPS: "Cardiac Electrophysiology",
    ES: "Endoscopy",
    GM: "General Microscopy",
    HC: "Hard Copy",
    HD: "Hemodynamic Waveform",
    IO: "Intra-Oral Radiography",
    IVUS: "Intravascular Ultrasound",
    KO: "Key Object Selection",
    LS: "Laser Surface Scan",
    MG: "Mammography",
    MR: "Magnetic Resonance",
    NM: "Nuclear Medicine",
    OAM: "Ophthalmic Axial Measurements",
    OCT: "Optical Coherence Tomography",
    OP: "Ophthalmic Photography",
    OPM: "Ophthalmic Mapping",
    OPT: "Ophthalmic Tomography",
    OPV: "Ophthalmic Visual Field",
    OT: "Other",
    PR: "Presentation State",
    PT: "Positron Emission Tomography",
    PX: "Panoramic X-Ray",
    REG: "Registration",
    RF: "Radio Fluoroscopy",
    RG: "Radiographic Imaging",
    RTDOSE: "Radiotherapy Dose",
    RTIMAGE: "Radiotherapy Image",
    RTPLAN: "Radiotherapy Plan",
    RTRECORD: "RT Treatment Record",
    RTSTRUCT: "Radiotherapy Structure Set",
    SEG: "Segmentation",
    SM: "Slide Microscopy",
    SMR: "Stereometric Relationship",
    SR: "Structured Report",
    SRF: "Subjective Refraction",
    TG: "Thermography",
    US: "Ultrasound",
    VA: "Visual Acuity",
    XA: "X-Ray Angiography",
    XC: "External-Camera Photography"
};

/**
 * Coerce a naturalized value to a trimmed string, or null.
 * Handles scalars, single/multi-value arrays (first value wins), and
 * numbers (IS/DS naturalize to Number).
 */
export function asString(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (Array.isArray(value)) {
        return value.length > 0 ? asString(value[0]) : null;
    }
    if (typeof value === "number") {
        return String(value);
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    return null;
}

/**
 * Coerce a naturalized value to a finite number, or null.
 */
export function asNumber(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (Array.isArray(value)) {
        return value.length > 0 ? asNumber(value[0]) : null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

/**
 * Prefix a DICOM UID with urn:oid: for FHIR identifier/uid slots.
 */
export function uidToUrn(uid) {
    const clean = asString(uid);
    if (!clean) {
        return null;
    }
    return clean.startsWith("urn:oid:") ? clean : `urn:oid:${clean}`;
}

/**
 * DICOM DA (YYYYMMDD) + optional TM (HHMMSS.ffffff) → ISO 8601.
 */
export function dicomDateTimeToIso(dicomDate, dicomTime) {
    const date = asString(dicomDate);
    if (!date || date.length < 8) {
        return null;
    }

    let iso = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(
        6,
        8
    )}`;

    const time = asString(dicomTime);
    if (time && time.length >= 6) {
        iso += `T${time.substring(0, 2)}:${time.substring(
            2,
            4
        )}:${time.substring(4, 6)}`;
    }

    return iso;
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
    return mapping[asString(dicomSex)] || "unknown";
}

/**
 * DICOM PatientSex → US Core birthsex code (M/F/UNK).
 */
export function sexToBirthSex(dicomSex) {
    const mapping = { M: "M", F: "F", O: "UNK" };
    return mapping[asString(dicomSex)] || "UNK";
}

/**
 * US Core birthsex extension for a DICOM PatientSex value.
 */
export function birthSexExtension(dicomSex) {
    if (!asString(dicomSex)) {
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
    const sex = asString(dicomSex);
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
    const value = asString(gender);
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
 * @returns {string|null} null when the name carries no usable parts
 */
export function humanNameToPersonName(humanName) {
    if (!humanName || typeof humanName !== "object") {
        return null;
    }
    const given = Array.isArray(humanName.given) ? humanName.given : [];
    const components = [
        asString(humanName.family) || "",
        asString(given[0]) || "",
        asString(given[1]) || "",
        asString(
            Array.isArray(humanName.prefix) ? humanName.prefix[0] : null
        ) || "",
        asString(
            Array.isArray(humanName.suffix) ? humanName.suffix[0] : null
        ) || ""
    ];
    while (components.length && components[components.length - 1] === "") {
        components.pop();
    }
    const pn = components.join("^");
    return pn.length > 0 ? pn : null;
}

/**
 * FHIR date (ISO 8601) → DICOM DA (YYYYMMDD). Inverse of
 * dicomDateTimeToIso for the date part. FHIR allows partial dates (YYYY,
 * YYYY-MM); DICOM DA does not — partial dates return null rather than a
 * fabricated day.
 */
export function isoDateToDicom(isoDate) {
    const value = asString(isoDate);
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
    const code = asString(modalityCode);
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
 * Uint8Array → base64 string without Node's Buffer (this package ships in
 * the browser bundle). Chunked to stay under argument-length limits.
 */
export function bytesToBase64(bytes) {
    const CHUNK = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + CHUNK)
        );
    }
    if (typeof btoa === "function") {
        return btoa(binary);
    }
    // Manual encoder for runtimes without btoa
    const ALPHABET =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let result = "";
    for (let i = 0; i < binary.length; i += 3) {
        const a = binary.charCodeAt(i);
        const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
        const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
        result += ALPHABET[a >> 2];
        result += ALPHABET[((a & 3) << 4) | (b >> 4)];
        result +=
            i + 1 < binary.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : "=";
        result += i + 2 < binary.length ? ALPHABET[c & 63] : "=";
    }
    return result;
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
