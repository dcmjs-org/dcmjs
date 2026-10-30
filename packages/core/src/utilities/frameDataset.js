import {
    definePrivateAliases,
    isPrivateTag,
    parsePrivateBlockKey
} from "./privateBlocks.js";

const ELEMENT_KEY = /^x[0-9A-Fa-f]{2}$/;

/**
 * The view of one frame of a multi-frame naturalized dataset (PS3.3
 * C.7.6.16): the root attributes, then the attributes of the shared
 * functional groups, then the attributes of the per-frame functional groups
 * of that frame. A later level replaces an attribute of an earlier level.
 *
 * - The view is built when NumberOfFrames is above 1, or when it is 1 or
 *   more and the dataset has a functional group sequence. A functional group
 *   sequence can be missing or empty: the view then holds only the computed
 *   attributes, for example the defaults of a multi-frame image that is not
 *   enhanced. Any other dataset comes back unchanged, and the option
 *   functions do not run.
 * - `frameNumber` is 1-based, and a numeric string is accepted. A frame
 *   number that is not an integer from 1 to NumberOfFrames throws a
 *   RangeError. A frame with no per-frame item reads the shared item and
 *   the root.
 * - Each standard sequence (functional group macro) in a functional group
 *   item gives the attributes of its first item. An item that holds a
 *   SOPInstanceUID is reference or previous value data, and is skipped.
 * - A private block or a private hex-tag key directly in a functional group
 *   item is skipped. With `options.privateMacros`, each private sequence
 *   there (an SQ in `_vrMap`) is a macro too. A private block inside a macro
 *   item is an attribute of the frame: it replaces a root block with the
 *   same key, and its hex aliases read the frame's block.
 * - The view is an `Object.create` child of `dataset`. The functional group
 *   attributes are its own keys, with their VRs in an own `_vrMap`, so
 *   `denaturalizeDataset(view)` writes only those attributes. Root
 *   attributes are inherited, so a change to the root shows in the view.
 * - `options.frameAttributes(view, { dataset, frameNumber })` returns the
 *   computed attributes of the frame, for example an ImagePositionPatient
 *   that a modality gives in another place. They become own enumerable keys
 *   of the view and replace the merged values.
 * - `options.frameProperties(view, { dataset, frameNumber })` returns the
 *   runtime properties of the frame, for example `frameNumber` or `imageId`.
 *   They become own non-enumerable properties, so JSON and denaturalize
 *   skip them.
 * - The views are cached on `dataset` in the non-enumerable
 *   `_frameDatasets`, per set of options: pass the same function objects on
 *   each call to use the cache. A change to a functional group item does not
 *   show in a cached view: `delete dataset._frameDatasets` to rebuild the
 *   views.
 *
 * docs/specs/naturalized-dataset.md (NAT-U-FRAME, NAT-I-FRAME) is the
 * specification.
 *
 * @param {Object} dataset - a naturalized dataset
 * @param {number|string} [frameNumber=1] - the 1-based frame number
 * @param {Object} [options]
 * @param {Function} [options.frameAttributes] - computed attributes
 * @param {Function} [options.frameProperties] - runtime properties
 * @param {boolean} [options.privateMacros=false] - read private macros
 * @returns {Object} the frame view, or `dataset`
 */
export function frameDataset(dataset, frameNumber = 1, options = {}) {
    const {
        NumberOfFrames,
        SharedFunctionalGroupsSequence: shared,
        PerFrameFunctionalGroupsSequence: perFrame
    } = dataset;
    const frames = Number(NumberOfFrames);
    if (!(frames > 1 || (frames > 0 && (shared || perFrame)))) {
        return dataset;
    }
    frameNumber = Number(frameNumber);
    if (
        !Number.isInteger(frameNumber) ||
        frameNumber < 1 ||
        frameNumber > frames
    ) {
        throw new RangeError(
            `Frame number ${frameNumber} is not in 1 to ${frames}`
        );
    }
    if (!Object.prototype.hasOwnProperty.call(dataset, "_frameDatasets")) {
        Object.defineProperty(dataset, "_frameDatasets", {
            value: new Map(),
            configurable: true
        });
    }
    const { frameAttributes, frameProperties, privateMacros = false } = options;
    const views = entry(
        entry(
            entry(dataset._frameDatasets, frameAttributes, Map),
            frameProperties,
            Map
        ),
        privateMacros,
        Array
    );
    if (views[frameNumber]) return views[frameNumber];

    const view = Object.create(dataset);
    view._vrMap = { ...dataset._vrMap };
    addFunctionalGroups(view, shared?.[0], privateMacros);
    addFunctionalGroups(view, perFrame?.[frameNumber - 1], privateMacros);
    const context = { dataset, frameNumber };
    defineValues(view, frameAttributes?.(view, context), true);
    defineValues(view, frameProperties?.(view, context), false);
    definePrivateAliases(view);
    views[frameNumber] = view;
    return view;
}

function entry(map, key, Type) {
    if (!map.has(key)) map.set(key, new Type());
    return map.get(key);
}

// a plain own value: an inherited alias or PN setter must not run
function defineValue(view, name, value, enumerable) {
    Object.defineProperty(view, name, {
        value,
        writable: true,
        enumerable,
        configurable: true
    });
}

function defineValues(view, values, enumerable) {
    for (const name of Object.keys(values || {})) {
        defineValue(view, name, values[name], enumerable);
    }
}

/** The sequences of a functional group item, private macros on request. */
function macros(groups, privateMacros) {
    const sequences = [];
    const vrMap = groups._vrMap || {};
    for (const key of Object.keys(groups)) {
        const value = groups[key];
        if (parsePrivateBlockKey(key, value)) {
            if (!privateMacros) continue;
            for (const elementKey of Object.keys(value)) {
                if (
                    ELEMENT_KEY.test(elementKey) &&
                    vrMap[key]?.[elementKey] === "SQ"
                ) {
                    sequences.push(value[elementKey]);
                }
            }
        } else if (!isPrivateTag(key)) {
            sequences.push(value);
        } else if (privateMacros && vrMap[key] === "SQ") {
            sequences.push(value);
        }
    }
    return sequences;
}

function addFunctionalGroups(view, groups, privateMacros) {
    if (!groups) return;
    for (const sequence of macros(groups, privateMacros)) {
        const item = sequence?.[0];
        if (!item || typeof item !== "object" || item.SOPInstanceUID) continue;
        for (const name of Object.keys(item)) {
            if (name !== "_vrMap") defineValue(view, name, item[name], true);
        }
        Object.assign(view._vrMap, item._vrMap);
    }
}
