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

/** Study level: Type 2 empties, plus a new study when it is not inherited. */
export function studyBase(context) {
    const base = {
        StudyID: "",
        AccessionNumber: "",
        ReferringPhysicianName: ""
    };
    if (!context.inherits("study")) {
        base.StudyInstanceUID = DicomMetaDictionary.uid();
        base.StudyDate = context.date;
        base.StudyTime = context.time;
    }
    return base;
}

/** Series level: a new series when it is not inherited. */
export function seriesBase(context) {
    if (context.inherits("series")) {
        return {};
    }
    return { SeriesInstanceUID: DicomMetaDictionary.uid(), SeriesNumber: 1 };
}

/** Instance: a new SOP instance and the encoding defaults. */
export function instanceBase() {
    return {
        SpecificCharacterSet: "ISO_IR 192",
        SOPInstanceUID: DicomMetaDictionary.uid(),
        InstanceNumber: 1,
        _meta: { TransferSyntaxUID: { Value: [EXPLICIT_LITTLE_ENDIAN] } }
    };
}

/** General Equipment: the creating software. */
export const equipmentBase = { Manufacturer: "dcmjs" };

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
    const studies = new Map();
    for (const instance of instances) {
        const {
            StudyInstanceUID,
            SeriesInstanceUID,
            SOPClassUID,
            SOPInstanceUID
        } = instance;
        if (
            !StudyInstanceUID ||
            !SeriesInstanceUID ||
            !SOPClassUID ||
            !SOPInstanceUID
        ) {
            throw new Error(
                "hierarchicalReferences: each instance needs StudyInstanceUID, " +
                    "SeriesInstanceUID, SOPClassUID, and SOPInstanceUID"
            );
        }
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
        PredecessorDocumentsSequence: hierarchicalReferences(
            [].concat(context.instance)
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
 * response). Put it after `seriesBase`. It does nothing when the series is
 * inherited.
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
            const value = Number(
                series.SeriesNumber ?? series["00200011"]?.Value?.[0]
            );
            if (Number.isFinite(value) && value > max) {
                max = value;
            }
        }
        return { SeriesNumber: max + 1 };
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
const CONSISTENCY_KEYS = ["Modality", "SOPClassUID"];

/**
 * Create a naturalized instance. The merge is
 *
 *     baseDicom  <  inherited  <  overrides
 *
 * - `baseDicom` is a base block (see {@link combineBases}). Function blocks
 *   get a context: `{ dataLevel, levels, instance, predecessor,
 *   inherits(levelName), date, time, dateTime, options }`, where
 *   `inherits(name)` is true when the level comes from `instance`. The level
 *   blocks use it to create new identity only for the levels below
 *   `dataLevel`.
 * - `inherited` is `copyAttributesByLevel(instance, dataLevel)`. Its object
 *   values are shared with `instance`; pass `deepCloneInstance(instance)` to
 *   avoid that.
 * - `overrides` is every other option that is a DICOM attribute: a
 *   dictionary keyword, an 8-hex-digit tag, or an `_` key (`_meta`,
 *   `_vrMap`). It always wins. Instance-level attributes (for example a
 *   specific `SOPInstanceUID`) go here. Any other key is dropped with a
 *   warning; a builder removes its own control options before the call.
 *
 * A warning is logged when the inherited Modality or SOPClassUID differs from
 * the base, because that object is valid DICOM only in special cases.
 *
 * @param {Object} [options]
 * @param {*} [options.baseDicom=defaultInstanceBase]
 * @param {Object|Object[]} [options.instance] - naturalized source instance(s)
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
        if (isAttributeKey(key)) {
            overrides[key] = rest[key];
        } else {
            log.warn(
                `createInstance: option "${key}" is not a DICOM attribute ` +
                    `and is not written to the dataset`
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
