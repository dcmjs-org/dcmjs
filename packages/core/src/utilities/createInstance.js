// packages/core/src/utilities/createInstance.js
//
// Build a naturalized instance from base blocks, context inherited from a
// source instance, and overrides.

import { DicomMetaDictionary } from "../DicomMetaDictionary.js";
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

/** True for an object whose prototype is `Object.prototype` (any realm). */
function isPlainObject(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === null || Object.getPrototypeOf(proto) === null;
}

/**
 * Resolve one naturalized DICOM provider to a fresh plain object for this
 * context (CORE-IMP-2). A provider is a plain object, a function
 * `(context) => provider`, an array of providers (a later entry wins), or a
 * block from {@link combineBases}. `undefined` and `null` give `{}`. Each
 * other value is copied into a new object (CORE-IMP-11).
 *
 * @param {Object|Function|Array|undefined|null} item - the provider
 * @param {Object} context - the context of {@link createInstance}
 * @returns {Object}
 */
export function resolveBase(item, context) {
    if (item === undefined || item === null) {
        return {};
    }
    if (Array.isArray(item)) {
        return Object.assign(
            {},
            ...item.map(entry => resolveBase(entry, context))
        );
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
 * The InstanceNumber of the sample instance + 1 when the series is inherited,
 * else 1 (CORE-USR-5). The sample is `instance`, or its first item when
 * `instance` is an array. A sample value that is not an integer, is negative,
 * or is at the IS maximum gives 1.
 */
function nextInstanceNumber(context = {}) {
    if (!context.inherits?.("series")) {
        return 1;
    }
    const sample = [].concat(context.instance)[0];
    const value = integerValue(sample?.InstanceNumber);
    return value >= 0 && value < IS_MAX ? value + 1 : 1;
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
 * replaces the older ones, and the older ones stay as they are. An optional
 * block (CORE-USR-9): not in `defaultInstanceBase`; the encapsulated
 * document bases add it, and a caller can add it to another base.
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
 * The default `postProcess` of {@link createInstance} (CORE-USR-15). It
 * deletes each top-level key whose value is `undefined`, and returns the same
 * dataset. It does not change nested values: the items of a sequence keep
 * their `undefined` values.
 *
 * @param {Object} dataset - a naturalized dataset
 * @returns {Object} the same dataset
 */
export function removeUndefinedAttributes(dataset) {
    for (const key of Object.keys(dataset)) {
        if (dataset[key] === undefined) {
            delete dataset[key];
        }
    }
    return dataset;
}

// Attributes where an inherited value that differs from the base is legal
// but usually a mistake, so it gets a warning.
const CONSISTENCY_KEYS = ["Modality"];

/**
 * Create a naturalized instance. The user requirements are CORE-USR-1 to
 * CORE-USR-15 in `packages/core/README.md`; the implementation requirements
 * are CORE-IMP-n there. The merge is
 *
 *     baseDicom  <  inherited  <  overrides
 *
 * - `baseDicom` is a naturalized DICOM provider: a base block (see
 *   {@link combineBases}). Function blocks get a context: `{ dataLevel,
 *   levels, instance, predecessor, inherits(levelName), date, time,
 *   dateTime, options }`, where `inherits(name)` is true when the level
 *   comes from `instance`.
 * - `inherited` is `copyAttributesByLevel(instance, dataLevel, { levels })`.
 *   The default levels hold no identity of `instance` (CORE-USR-4). Its
 *   object values are shared with `instance` (CORE-IMP-6).
 * - `overrides` is a naturalized DICOM provider with the same forms as
 *   `baseDicom`. `resolveBase(options.overrides, context)` resolves it. Each
 *   key goes into the merge (CORE-USR-7), also a key with an `undefined`
 *   value. An 8-hex key needs a `_vrMap` entry; the hex form of a standard
 *   tag does not replace its keyword form.
 *
 * The resolution order (CORE-IMP-1): the context is built first; then
 * `baseDicom` resolves, then `overrides` resolves once, with the same
 * context. Then the merge runs, and then `postProcess(result, context)`.
 * The return value of `postProcess` is the return value of `createInstance`.
 * The default `postProcess` is {@link removeUndefinedAttributes}, so an
 * `undefined` value removes the attribute (CORE-USR-8). Use `""` or `null`
 * for a Type 2 empty value.
 *
 * The options object holds the control keys below; attributes go in
 * `overrides`. Another top-level key has no effect (CORE-USR-7). An unknown
 * `dataLevel` throws (CORE-USR-3).
 *
 * With `dataLevel: "series"` (or a deeper custom level), `instance` is the
 * sample instance in the series, and the new InstanceNumber is the sample
 * InstanceNumber + 1 (CORE-USR-5).
 *
 * @example
 * createInstance({
 *     instance: prior,
 *     dataLevel: "series",
 *     overrides: { SeriesDescription: "Report" }
 * });
 *
 * @param {Object} [options]
 * @param {*} [options.baseDicom=defaultInstanceBase]
 * @param {Object|Object[]} [options.instance] - naturalized source
 *   instance(s); naturalize DICOM JSON first with
 *   `DicomMetaDictionary.naturalizeDataset`
 * @param {string} [options.dataLevel="study"]
 * @param {Object[]} [options.levels=DATA_LEVELS]
 * @param {boolean} [options.predecessor=false] - reference each `instance` as
 *   a predecessor; no effect unless the base includes
 *   {@link predecessorBase}
 * @param {Object|Function|Array} [options.overrides] - a naturalized DICOM
 *   provider (the forms of `baseDicom`) whose attributes replace the base and
 *   inherited values
 * @param {Function} [options.postProcess=removeUndefinedAttributes] -
 *   `(dataset, context) => dataset`, called on the merged result; its
 *   return value is the result (CORE-USR-15)
 * @returns {Object} naturalized dataset
 */
export function createInstance(options = {}) {
    const {
        baseDicom = defaultInstanceBase,
        instance,
        dataLevel = "study",
        levels = DATA_LEVELS,
        predecessor = false,
        postProcess = removeUndefinedAttributes
    } = options;

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
    const overrides = resolveBase(options.overrides, context);
    const inherited = copyAttributesByLevel(instance, dataLevel, { levels });
    for (const key of CONSISTENCY_KEYS) {
        if (
            base[key] &&
            inherited[key] &&
            !Object.hasOwn(overrides, key) &&
            base[key] !== inherited[key]
        ) {
            log.warn(
                `createInstance: inherited ${key} "${inherited[key]}" ` +
                    `differs from the base "${base[key]}"`
            );
        }
    }

    const result = { ...base, ...inherited, ...overrides };
    // An `_meta` override merges key by key (CORE-USR-6).
    if (isPlainObject(overrides._meta)) {
        result._meta = {
            ...(isPlainObject(base._meta) ? base._meta : {}),
            ...(isPlainObject(inherited._meta) ? inherited._meta : {}),
            ...overrides._meta
        };
    }
    return postProcess(result, context);
}
