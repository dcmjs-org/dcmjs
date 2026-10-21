// packages/core/src/utilities/createInstance.js
//
// Build a naturalized instance from base blocks, context inherited from a
// source instance, and explicit overrides.

import { DicomMetaDictionary } from "../DicomMetaDictionary.js";
import { lookupRegisteredTagByName } from "../dictionary.fast.js";
import { EXPLICIT_LITTLE_ENDIAN } from "../constants/dicom.js";
import log from "../log.js";
import {
    DATA_LEVELS,
    copyAttributesByLevel,
    dataLevelIndex
} from "./copyAttributesByLevel.js";

/**
 * Combine base blocks into one block. Each item is a plain object, a function
 * `(context) => object`, an array of items, or another combined block; later
 * items win. The result keeps its parts on `.items`, so a caller can rebuild a
 * variant, for example `combineBases(...base.items.filter(i => i !== x), y)`.
 *
 * @param {...(Object|Function|Array)} items
 * @returns {Function} a base block
 */
export function combineBases(...items) {
    const combined = context =>
        Object.assign({}, ...items.map(item => resolveBase(item, context)));
    combined.items = items;
    return combined;
}

/** Resolve one base item to a fresh plain object for this context. */
export function resolveBase(item, context) {
    if (item === undefined || item === null) {
        return {};
    }
    if (Array.isArray(item)) {
        return combineBases(...item)(context);
    }
    if (typeof item === "function") {
        return resolveBase(item(context), context);
    }
    return { ...item };
}

/** Patient level: the Type 2 identity attributes, empty. */
export const patientBase = {
    PatientName: "",
    PatientID: "",
    PatientBirthDate: "",
    PatientSex: ""
};

/**
 * Study level: Type 2 empties, plus a new study when it is not inherited. An
 * inherited study gets empty StudyDate/StudyTime, which a source value
 * replaces.
 */
export function studyBase(context) {
    const base = {
        StudyID: "",
        AccessionNumber: "",
        ReferringPhysicianName: "",
        StudyDate: "",
        StudyTime: ""
    };
    if (!context.inherits("study")) {
        base.StudyInstanceUID = DicomMetaDictionary.uid();
        base.StudyDate = context.date;
        base.StudyTime = context.time;
    }
    return base;
}

/**
 * Series level: a new series when it is not inherited. An inherited series
 * gets an empty SeriesNumber (Type 2), which a source value replaces.
 */
export function seriesBase(context) {
    if (context.inherits("series")) {
        return { SeriesNumber: "" };
    }
    return { SeriesInstanceUID: DicomMetaDictionary.uid(), SeriesNumber: 1 };
}

/** The largest value of VR IS (a signed 32-bit integer). */
const IS_MAX = 2147483647;

/** The smallest value of VR IS. */
const IS_MIN = -2147483648;

/**
 * An IS value as an integer: a number, an IS string, or a one-element array
 * of them. A value outside the IS range, or anything else, gives `undefined`.
 */
function integerValue(value) {
    if (Array.isArray(value)) {
        value = value.length === 1 ? value[0] : undefined;
    }
    if (typeof value === "string") {
        value = /^\s*[+-]?\d+\s*$/.test(value) ? Number(value) : undefined;
    }
    return Number.isInteger(value) && value >= IS_MIN && value <= IS_MAX
        ? value
        : undefined;
}

/**
 * The InstanceNumber after the prior instances in the target series
 * (CORE-USR-5). An item counts when its `SeriesInstanceUID` is the target
 * series; an item without one counts only when the target series is the
 * series of the first item.
 */
function nextInstanceNumber(context = {}) {
    if (!context.inherits?.("series")) {
        return 1;
    }
    const instances = [].concat(context.instance);
    const inheritedSeries = instances[0]?.SeriesInstanceUID;
    const override = context.options?.SeriesInstanceUID;
    const hasOverride = override !== undefined && override !== null;
    const series = hasOverride ? override : inheritedSeries;
    const sameAsFirst = !hasOverride || override === inheritedSeries;
    let max;
    for (const instance of instances) {
        const other = instance?.SeriesInstanceUID;
        if (other ? other !== series : !sameAsFirst) {
            continue;
        }
        const value = integerValue(instance?.InstanceNumber);
        if (value >= 0 && (max === undefined || value > max)) {
            max = value;
        }
    }
    return max !== undefined && max < IS_MAX ? max + 1 : 1;
}

/** Instance: a new SOP instance and the encoding defaults. */
export function instanceBase(context) {
    return {
        SpecificCharacterSet: "ISO_IR 192",
        SOPInstanceUID: DicomMetaDictionary.uid(),
        InstanceNumber: nextInstanceNumber(context),
        _meta: { TransferSyntaxUID: { Value: [EXPLICIT_LITTLE_ENDIAN] } }
    };
}

/** General Equipment: the creating software. */
export const equipmentBase = { Manufacturer: "dcmjs" };

const REFERENCE_KEYS = [
    "StudyInstanceUID",
    "SeriesInstanceUID",
    "SOPClassUID",
    "SOPInstanceUID"
];
const REFERENCE_KEYS_TEXT =
    "StudyInstanceUID, SeriesInstanceUID, SOPClassUID, and SOPInstanceUID";

/**
 * Reference instances in the Hierarchical SOP Instance Reference shape:
 * `[{ StudyInstanceUID, ReferencedSeriesSequence: [{ SeriesInstanceUID,
 * ReferencedSOPSequence: [{ ReferencedSOPClassUID,
 * ReferencedSOPInstanceUID }] }] }]`, one item for each study and series.
 *
 * @param {Object[]} instances - naturalized instances
 * @returns {Object[]} the study items
 */
export function hierarchicalReferences(instances) {
    return buildReferences(
        instances,
        missing =>
            `hierarchicalReferences: an instance is missing ${missing}; ` +
            `each instance needs ${REFERENCE_KEYS_TEXT}`
    );
}

/** hierarchicalReferences, with the error text of the caller. */
function buildReferences(instances, missingText) {
    const studies = new Map();
    for (const instance of instances) {
        const missing = REFERENCE_KEYS.filter(key => !instance?.[key]);
        if (missing.length) {
            throw new Error(missingText(missing.join(", ")));
        }
        const {
            StudyInstanceUID,
            SeriesInstanceUID,
            SOPClassUID,
            SOPInstanceUID
        } = instance;
        if (!studies.has(StudyInstanceUID)) {
            studies.set(StudyInstanceUID, new Map());
        }
        const series = studies.get(StudyInstanceUID);
        if (!series.has(SeriesInstanceUID)) {
            series.set(SeriesInstanceUID, []);
        }
        series.get(SeriesInstanceUID).push({
            ReferencedSOPClassUID: SOPClassUID,
            ReferencedSOPInstanceUID: SOPInstanceUID
        });
    }
    return [...studies].map(([StudyInstanceUID, series]) => ({
        StudyInstanceUID,
        ReferencedSeriesSequence: [...series].map(
            ([SeriesInstanceUID, ReferencedSOPSequence]) => ({
                SeriesInstanceUID,
                ReferencedSOPSequence
            })
        )
    }));
}

/**
 * Predecessor: when `context.predecessor` is set, every source instance goes
 * in `PredecessorDocumentsSequence (0040,A360)`. The new instance then
 * replaces the older ones, and the older ones stay as they are. Not in
 * `defaultInstanceBase`; the document builders add it.
 */
export function predecessorBase(context) {
    if (!context.predecessor || !context.instance) {
        return {};
    }
    return {
        PredecessorDocumentsSequence: buildReferences(
            [].concat(context.instance),
            missing =>
                `predecessor: the instance is missing ${missing}; the ` +
                `instance must identify the source instance with ` +
                REFERENCE_KEYS_TEXT
        )
    };
}

/** The core default: one block for each level, plus equipment. */
export const defaultInstanceBase = combineBases(
    patientBase,
    studyBase,
    seriesBase,
    instanceBase,
    equipmentBase
);

/**
 * A base block that sets `SeriesNumber` to one more than the largest series
 * number in `seriesList` (naturalized, or DICOM JSON such as a QIDO-RS series
 * response). A value that is not an IS integer does not count. Put it after
 * `seriesBase`. It does nothing when the series is inherited.
 *
 * @param {Object[]} seriesList
 * @param {Function} [filter] - `(series) => boolean`, for example to count
 *   only the series of one modality
 * @returns {Function} a base block
 */
export function nextSeriesNumberBase(seriesList, filter = () => true) {
    return context => {
        if (context.inherits("series")) {
            return {};
        }
        let max = 0;
        for (const series of seriesList || []) {
            if (!filter(series)) {
                continue;
            }
            const value = integerValue(
                series.SeriesNumber ?? series["00200011"]?.Value?.[0]
            );
            if (value > max) {
                max = value;
            }
        }
        return { SeriesNumber: max < IS_MAX ? max + 1 : 1 };
    };
}

/**
 * True for a key that can be a dataset attribute: a dictionary keyword, a
 * keyword added with `registerTag`, an 8-hex-digit tag, or an `_` key such as
 * `_meta` or `_vrMap`.
 */
function isAttributeKey(key) {
    return (
        key.startsWith("_") ||
        /^[0-9A-Fa-f]{8}$/.test(key) ||
        Object.prototype.hasOwnProperty.call(
            DicomMetaDictionary.nameMap,
            key
        ) ||
        lookupRegisteredTagByName(key) !== undefined
    );
}

// Attributes where an inherited value that differs from the base is legal
// but usually a mistake, so it gets a warning.
const CONSISTENCY_KEYS = ["Modality"];

/**
 * The identity of the source instance itself (CORE-USR-4). `createInstance`
 * never inherits these from `instance`, whatever `levels` lists; an override
 * or the base blocks set them.
 */
const INSTANCE_IDENTITY_KEYS = Object.freeze([
    "SOPInstanceUID",
    "SOPClassUID",
    "InstanceNumber",
    "MediaStorageSOPInstanceUID",
    "MediaStorageSOPClassUID"
]);

/**
 * True when an instance is DICOM JSON (CORE-IMP-10): every key is an
 * 8-hex-digit tag, and at least one value is an object with `vr`. A
 * naturalized dataset has keyword keys, also when it keeps a private element
 * as `{ vr, Value }` under its tag.
 */
function isDicomJson(instance) {
    const keys = Object.keys(instance);
    return (
        keys.length > 0 &&
        keys.every(key => /^[0-9A-Fa-f]{8}$/.test(key)) &&
        keys.some(key => {
            const value = instance[key];
            return (
                value !== null &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                "vr" in value
            );
        })
    );
}

/**
 * Create a naturalized instance. The user requirements are CORE-USR-1 to
 * CORE-USR-14 in `packages/core/README.md`; the implementation requirements
 * are CORE-IMP-n there. The merge is
 *
 *     baseDicom  <  inherited  <  overrides
 *
 * - `baseDicom` is a base block (see {@link combineBases}). Function blocks
 *   get a context: `{ dataLevel, levels, instance, predecessor,
 *   inherits(levelName), date, time, dateTime, options }`, where
 *   `inherits(name)` is true when the level comes from `instance`.
 * - `inherited` is `copyAttributesByLevel(instance, dataLevel)` without the
 *   identity of `instance` (CORE-USR-4). Its object values are shared with
 *   `instance` (CORE-IMP-6).
 * - `overrides` is every other option that is a DICOM attribute: a
 *   dictionary keyword, a `registerTag` keyword, an 8-hex-digit tag, or an
 *   `_` key (CORE-USR-7, CORE-USR-8). An 8-hex key needs a `_vrMap` entry;
 *   the hex form of a standard tag does not replace its keyword form.
 *
 * With `dataLevel: "series"` (or a deeper custom level), `instance` is the
 * prior instance in the series (CORE-USR-5).
 *
 * @param {Object} [options]
 * @param {*} [options.baseDicom=defaultInstanceBase]
 * @param {Object|Object[]} [options.instance] - naturalized source instance(s);
 *   DICOM JSON throws (naturalize it first with
 *   `DicomMetaDictionary.naturalizeDataset`)
 * @param {string} [options.dataLevel="study"]
 * @param {Object[]} [options.levels=DATA_LEVELS]
 * @param {boolean} [options.predecessor=false] - reference each `instance` as
 *   a predecessor (see {@link predecessorBase})
 * @returns {Object} naturalized dataset
 */
export function createInstance(options = {}) {
    const {
        baseDicom = defaultInstanceBase,
        instance,
        dataLevel = "study",
        levels = DATA_LEVELS,
        predecessor = false,
        ...rest
    } = options;

    const overrides = {};
    for (const key of Object.keys(rest)) {
        if (rest[key] === undefined) {
            continue;
        }
        if (isAttributeKey(key)) {
            overrides[key] = rest[key];
        } else {
            log.warn(
                `createInstance: option "${key}" is not a DICOM attribute ` +
                    `and is not written to the dataset`
            );
        }
    }

    for (const item of [].concat(instance ?? [])) {
        if (item && typeof item === "object" && isDicomJson(item)) {
            throw new Error(
                "createInstance: instance is DICOM JSON (tag keys with " +
                    "{ vr, Value }); naturalize it first with " +
                    "DicomMetaDictionary.naturalizeDataset"
            );
        }
    }

    const levelIndex = dataLevelIndex(dataLevel, levels);
    const hasInstance = instance !== undefined && instance !== null;
    const context = {
        dataLevel,
        levels,
        instance,
        predecessor,
        inherits: name => {
            const index = levels.findIndex(level => level.name === name);
            return hasInstance && index !== -1 && index <= levelIndex;
        },
        date: DicomMetaDictionary.date(),
        time: DicomMetaDictionary.time(),
        dateTime: DicomMetaDictionary.dateTime(),
        options
    };

    const base = resolveBase(baseDicom, context);
    const inherited = copyAttributesByLevel(instance, dataLevel, { levels });
    for (const key of INSTANCE_IDENTITY_KEYS) {
        delete inherited[key];
    }

    for (const key of CONSISTENCY_KEYS) {
        if (
            base[key] &&
            inherited[key] &&
            !overrides[key] &&
            base[key] !== inherited[key]
        ) {
            log.warn(
                `createInstance: inherited ${key} "${inherited[key]}" ` +
                    `differs from the base "${base[key]}"`
            );
        }
    }

    return { ...base, ...inherited, ...overrides };
}
