// packages/core/src/utilities/copyAttributesByLevel.js
//
// The DICOM information model is a hierarchy — Patient > Study > Series >
// Instance — and when you build one instance from the context of another
// (a report filed under an existing study, a derived object, ...), the
// attributes that identify the broader levels should carry over while the
// narrower ones are minted fresh. This module names the attributes of each
// level as Sets and copies them off a naturalized source instance down to a
// chosen level.
//
// The Set contents and names mirror cornerstone3D's adapters
// (packages/adapters/src/adapters/helpers/copyStudyTags.ts) so the two
// codebases share one vocabulary.

/** Patient-level attributes (General Patient module identity). */
export const patientTags = new Set([
    "PatientName",
    "PatientID",
    "PatientBirthDate",
    "PatientBirthTime",
    "IssuerOfPatientID",
    "OtherPatientIDs",
    "OtherPatientIDsSequence",
    "PatientSex",
    "PatientIdentityRemoved",
    "DeidentificationMethodCodeSequence"
]);

/** Study-level attributes (General Study module). */
export const studyTags = new Set([
    "StudyDate",
    "StudyTime",
    "StudyStatusID",
    "StudyPriorityID",
    "StudyInstanceUID",
    "StudyDescription",
    "AccessionNumber",
    "StudyID",
    "ReferringPhysicianName",
    "TimezoneOffsetFromUTC"
]);

/** Series-level attributes (General Series module). */
export const seriesTags = new Set([
    "SeriesInstanceUID",
    "SeriesNumber",
    "SeriesDescription",
    "Modality",
    "SeriesDate",
    "SeriesTime"
]);

/** Patient + Study, the common "study context" pairing. */
export const patientStudyTags = new Set([...patientTags, ...studyTags]);

// The hierarchy, broadest first. Each level cumulatively includes the ones
// above it. There is no instance-level Set: instance identity (SOPInstanceUID,
// InstanceNumber) is always minted fresh, never inherited, so `instance` adds
// nothing beyond series — it exists only so callers can name the full depth.
const LEVEL_TAGS = [
    ["patient", patientTags],
    ["study", studyTags],
    ["series", seriesTags],
    ["instance", new Set()]
];

const DATA_LEVELS = LEVEL_TAGS.map(([name]) => name);

/**
 * Copy the attributes of a naturalized source instance that belong at or
 * above a given level of the DICOM information model.
 *
 * Hierarchical inheritance: patient-level attributes flow down to every
 * level; each level adds its own. `dataLevel: 'patient'` copies only patient
 * attributes; `'study'` adds study; `'series'` adds series; `'instance'` adds
 * nothing beyond series (instance identity is always minted fresh).
 *
 * Only attributes actually present and non-empty on the source are copied, so
 * an empty Type 2 value never shadows a builder default downstream.
 * `_meta`/`_vrMap` are intentionally not copied — those describe the target
 * dataset's own encoding, not inheritable context.
 *
 * @param {Object|Object[]} sourceInstance - a naturalized instance, or an
 *   array of them from one study (the first is read — they share this context)
 * @param {('patient'|'study'|'series'|'instance')} [dataLevel="study"]
 * @returns {Object} a plain object of the copied attributes
 */
export function copyAttributesByLevel(sourceInstance, dataLevel = "study") {
    if (sourceInstance === undefined || sourceInstance === null) {
        return {};
    }
    const source = Array.isArray(sourceInstance)
        ? sourceInstance[0]
        : sourceInstance;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error(
            "copyAttributesByLevel: sourceInstance must be a naturalized " +
                "dataset (or a non-empty array of them)"
        );
    }

    const levelIndex = DATA_LEVELS.indexOf(dataLevel);
    if (levelIndex === -1) {
        throw new Error(
            `copyAttributesByLevel: unknown dataLevel "${dataLevel}" ` +
                `(expected one of ${DATA_LEVELS.join(", ")})`
        );
    }

    const result = {};
    for (let i = 0; i <= levelIndex; i++) {
        for (const key of LEVEL_TAGS[i][1]) {
            if (source[key] !== undefined && source[key] !== "") {
                result[key] = source[key];
            }
        }
    }
    return result;
}

export { DATA_LEVELS };
