// packages/core/src/utilities/copyAttributesByLevel.js
//
// The attributes of each level of the DICOM information model, and a copy of
// those attributes off a naturalized source instance down to a chosen level.

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

/** Study-level attributes (General Study and Patient Study modules). */
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
    "TimezoneOffsetFromUTC",
    "PatientAge",
    "PatientSize",
    "PatientWeight"
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

/**
 * The default level hierarchy, broadest first. Each entry is
 * `{ name, tags }`. There is no instance level: instance attributes have no
 * fixed list, so the caller sets them as overrides.
 *
 * A change to these entries or Sets changes the default for every caller. To
 * change one call only, pass a new list (see {@link extendDataLevels}) as the
 * `levels` option.
 */
export const DATA_LEVELS = [
    { name: "patient", tags: patientTags },
    { name: "study", tags: studyTags },
    { name: "series", tags: seriesTags }
];

/**
 * Return a new level list with extra attributes added to the named levels.
 *
 * @param {Object[]} levels - a level list, for example `DATA_LEVELS`
 * @param {Object<string, Iterable<string>>} extraTags - level name to the
 *   attribute keywords to add, for example `{ patient: ["PatientComments"] }`
 * @returns {Object[]} a new level list
 */
export function extendDataLevels(levels, extraTags) {
    return levels.map(level => {
        const extra = extraTags[level.name];
        if (!extra) {
            return level;
        }
        return { name: level.name, tags: new Set([...level.tags, ...extra]) };
    });
}

/**
 * Index of `dataLevel` in `levels`; throws for an unknown level name.
 *
 * @param {string} dataLevel
 * @param {Object[]} [levels=DATA_LEVELS]
 * @returns {number}
 */
export function dataLevelIndex(dataLevel, levels = DATA_LEVELS) {
    const index = levels.findIndex(level => level.name === dataLevel);
    if (index === -1) {
        throw new Error(
            `unknown dataLevel "${dataLevel}" (expected one of ` +
                `${levels.map(level => level.name).join(", ")})`
        );
    }
    return index;
}

/**
 * Copy the attributes of a naturalized source instance that belong at or
 * above a given level of the DICOM information model.
 *
 * Patient-level attributes flow down to every level, and each level adds its
 * own. `_meta`/`_vrMap` are never copied, because those describe the
 * target's encoding.
 *
 * Only values that are present and not `""` are copied, so an empty Type 2
 * value never shadows a builder default.
 *
 * Object values (sequences, PN objects, binary) are the same objects as in
 * the source. To get independent values, pass `deepCloneInstance(source)`.
 *
 * @param {Object|Object[]} sourceInstance - a naturalized instance, or an
 *   array of them from one study (the first is read)
 * @param {string} [dataLevel="study"] - a level name from `levels`
 * @param {Object} [options]
 * @param {Object[]} [options.levels=DATA_LEVELS] - the level hierarchy
 * @returns {Object} a plain object of the copied attributes
 */
export function copyAttributesByLevel(
    sourceInstance,
    dataLevel = "study",
    { levels = DATA_LEVELS } = {}
) {
    if (sourceInstance === undefined || sourceInstance === null) {
        return {};
    }
    const source = Array.isArray(sourceInstance)
        ? sourceInstance[0]
        : sourceInstance;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error(
            "copyAttributesByLevel: instance must be a naturalized " +
                "dataset (or a non-empty array of them)"
        );
    }

    const levelIndex = dataLevelIndex(dataLevel, levels);
    const result = {};
    for (let i = 0; i <= levelIndex; i++) {
        for (const key of levels[i].tags) {
            const value = source[key];
            if (value !== undefined && value !== "") {
                result[key] = value;
            }
        }
    }
    return result;
}
