import {
    EventStreamListener,
    mergeFragmentsPerBotWindow
} from "./EventStreamListener.js";
import { lookupTagHex } from "../dicom.lookup.js";
import { lookupPrivateTag } from "../dictionary.private.data.js";
import addAccessors from "../utilities/addAccessors.js";
import dicomJson from "../utilities/dicomJson.js";
import log from "../log.js";

/**
 * NaturalizedListener — slice D1: the core naturalized value model.
 *
 * An event-stream consumer that builds the application-facing naturalized
 * object per the Naturalized DICOM Metadata Behavior Specification: canonical
 * keyword keys (§5) and VM-driven cardinality (§7-§14). Because it consumes the
 * source-agnostic contract, the SAME naturalized object is produced from Part 10
 * bytes, a dcmjs dict, or DICOMweb JSON.
 *
 * Scope (D1): keyword naming, VM cardinality, single-item sequences with hidden
 * length (§12, via the shared addAccessors proxy), empty→null/[], binary
 * assembly (InlineBinary/BulkDataURI), and the cardinality-violation policy
 * (§15.2, default warnAndPreserve). Deferred to D2: the PN proxy/toString sugar
 * (§17), private-tag grouping (§18), and precision/raw retention (§16/§27, which
 * needs the contract to carry raw values).
 *
 * Sequence note: a DICOM sequence's declared VM ("1") constrains how many times
 * the attribute appears, NOT its item count — multi-item sequences (e.g.
 * PerFrameFunctionalGroupsSequence) are normal, not violations. Violations apply
 * to non-sequence scalar VRs whose value count exceeds the declared VM.
 */
export class NaturalizedListener extends EventStreamListener {
    /**
     * @param {Object} [options]
     * @param {string} [options.cardinalityViolationPolicy="warnAndPreserve"]
     *   One of preserve | discardExtra | warnAndPreserve | warnAndDiscardExtra |
     *   recordAndPreserve | recordAndDiscardExtra | throw.
     */
    constructor(options = {}, ...filters) {
        super(...filters);
        this.policy = options.cardinalityViolationPolicy || "warnAndPreserve";
        this.result = {};
        this.meta = {};
        this.violations = [];
        // Frame stack. Each frame is one of:
        //   { kind: "object", obj }              dataset or sequence item
        //   { kind: "element", tag, vr, values, binary }
        //   { kind: "sequence", tag, vr, items }
        this._stack = [];
    }

    _objectFrame() {
        for (let i = this._stack.length - 1; i >= 0; i--) {
            if (this._stack[i].kind === "object") {
                return this._stack[i];
            }
        }
        return null;
    }

    _baseStartDataSet() {
        this.result = {};
        this.meta = {};
        this.violations = [];
        this._stack = [{ kind: "object", obj: this.result }];
    }

    _baseEndDataSet() {}

    _baseStartFileMetaInformation() {
        this._stack.push({ kind: "object", obj: this.meta });
    }

    _baseEndFileMetaInformation() {
        this._stack.pop();
    }

    _baseStartElement(tag, info = {}) {
        this._stack.push({
            kind: "element",
            tag,
            vr: info.vr,
            values: [],
            rawValues: [],
            binary: undefined
        });
    }

    _baseValue(v, opts = {}) {
        const frame = this._stack[this._stack.length - 1];
        frame.values.push(v);
        frame.rawValues.push(opts.rawValue);
    }

    _baseBulkDataReference(ref = {}) {
        this._stack[this._stack.length - 1].binary = { BulkDataURI: ref.uri };
    }

    _baseStartBinary(info = {}) {
        const frame = this._stack[this._stack.length - 1];
        frame._fragments = [];
        // A non-empty basicOffsetTable is kept so endBinary can merge the
        // raw fragments per BOT window (eager-reader frame shape parity,
        // issue #204).
        frame._binaryInfo = info;
    }

    _baseBinaryFragment(chunk) {
        this._stack[this._stack.length - 1]._fragments.push(chunk);
    }

    _baseEndBinary() {
        const frame = this._stack[this._stack.length - 1];
        let fragments = frame._fragments || [];
        const bot = frame._binaryInfo && frame._binaryInfo.basicOffsetTable;
        if (bot && bot.length) {
            fragments = mergeFragmentsPerBotWindow(fragments, bot);
        }
        frame.binary = {
            InlineBinary: fragments.length === 1 ? fragments[0] : fragments
        };
        frame._fragments = undefined;
        frame._binaryInfo = undefined;
    }

    _baseEndElement() {
        const frame = this._stack.pop();
        const targetFrame = this._objectFrame();

        // §16 precision: where a canonical JS number would lose precision and a
        // raw source string is available, retain the raw string.
        if (frame.binary === undefined && frame.rawValues) {
            for (let i = 0; i < frame.values.length; i++) {
                frame.values[i] = retainPrecision(
                    frame.vr,
                    frame.values[i],
                    frame.rawValues[i]
                );
            }
        }

        if (isPrivateTag(frame.tag)) {
            this._placePrivate(targetFrame, frame);
            return;
        }

        const entry = lookupTagHex(frame.tag);
        const key = (entry && entry.name) || frame.tag;
        if (frame.binary !== undefined) {
            targetFrame.obj[key] = frame.binary;
            return;
        }
        let shaped = this._shapeValues(frame, entry, key);
        if (frame.vr === "PN" && shaped !== null) {
            shaped = addPersonNameAccessors(shaped);
        }
        targetFrame.obj[key] = shaped;
    }

    _baseStartSequence(tag, info = {}) {
        this._stack.push({ kind: "sequence", tag, vr: info.vr, items: [] });
    }

    _baseStartItem() {
        this._stack.push({ kind: "object", obj: {} });
    }

    _baseEndItem() {
        const itemFrame = this._stack.pop();
        // The enclosing frame is the sequence.
        this._stack[this._stack.length - 1].items.push(itemFrame.obj);
    }

    _baseEndSequence() {
        const frame = this._stack.pop();
        const targetFrame = this._objectFrame();
        const shaped = this._shapeSequence(frame, lookupTagHex(frame.tag));

        if (isPrivateTag(frame.tag)) {
            this._placePrivateValue(targetFrame, frame.tag, frame.vr, shaped);
            return;
        }
        const entry = lookupTagHex(frame.tag);
        const key = (entry && entry.name) || frame.tag;
        targetFrame.obj[key] = shaped;
    }

    // --- private-tag grouping (§18) -----------------------------------------

    _placePrivate(targetFrame, frame) {
        const elem = parseInt(frame.tag.slice(4, 8), 16);
        // Private creator (gggg,00xx): record it for the block; do NOT emit it
        // as an ordinary attribute (§18.5).
        if (elem <= 0x00ff) {
            const v =
                frame.values && frame.values.length ? frame.values[0] : null;
            if (v != null) {
                targetFrame.creators = targetFrame.creators || {};
                targetFrame.creators[elem] = String(v);
            }
            return;
        }
        const value =
            frame.binary !== undefined
                ? frame.binary
                : privateShape(frame.values);
        this._placePrivateValue(targetFrame, frame.tag, frame.vr, value);
    }

    _placePrivateValue(targetFrame, tag, vr, value) {
        const elem = parseInt(tag.slice(4, 8), 16);
        const slot = elem >> 8; // creator slot (high byte of the element)
        const offset = elem & 0xff; // block-relative element (low byte)
        const creator = targetFrame.creators && targetFrame.creators[slot];

        if (creator) {
            const groupKey = `${hex2(slot)}:${creator}`;
            let group = targetFrame.obj[groupKey];
            if (!group) {
                group = { originalTagOffset: slot };
                targetFrame.obj[groupKey] = group;
            }
            group[privateKeyFor(tag, creator, offset, group)] = value;
            return;
        }
        // §18.4: no identifiable creator -> full tag key, unknown attribute shape.
        targetFrame.obj[tag] = {
            vr,
            Value: Array.isArray(value) ? value : value == null ? [] : [value]
        };
    }

    // --- cardinality shaping ------------------------------------------------

    _shapeValues(frame, entry, key) {
        const values = frame.values;
        const multi = isMultiVM(entry && entry.vm);

        if (multi) {
            // §10/§11: always list-like; present-empty -> [].
            return values;
        }
        // Scalar VM (1 or 0-1).
        if (values.length === 0) {
            return null; // §7/§9 present-empty
        }
        if (values.length === 1) {
            return values[0];
        }
        // §8: scalar VM with 2+ actual values -> cardinality violation.
        return this._applyViolation(key, values, 1);
    }

    _shapeSequence(frame, entry) {
        const items = frame.items;
        const declaredMulti = isMultiVM(entry && entry.vm);

        if (items.length === 0) {
            return []; // §12 present-empty
        }
        if (items.length === 1 && !declaredMulti) {
            // §12: single item exposed as the item object with hidden length 1
            // (the shared addAccessors proxy delegates property access to it).
            return addAccessors(items);
        }
        // §13: multiple items -> list-like. Not a violation (declared SQ VM
        // constrains attribute occurrence, not item count).
        return items;
    }

    _applyViolation(keyword, values, declaredMax) {
        const violation = {
            keyword,
            declaredMax,
            actual: values.length
        };
        const discard = /DiscardExtra$/.test(this.policy);
        const kept = discard ? values.slice(0, declaredMax) : values.slice();

        if (this.policy === "throw") {
            throw new Error(
                `Cardinality violation: ${keyword} has ${values.length} values, declared VM ${declaredMax}`
            );
        }
        if (/^warn/.test(this.policy)) {
            log.warn(
                `Cardinality violation: ${keyword} has ${values.length} values (declared VM ${declaredMax})`
            );
        }
        this.violations.push(violation);

        // discardExtra of a now-scalar VM collapses to the single kept value.
        if (discard && declaredMax === 1) {
            return kept[0];
        }
        return kept;
    }
}

/**
 * A private tag has an odd group number and an element at or above 0x0010 (the
 * first usable private creator slot). Group-length (0x0000) and reserved low
 * elements fall through to standard handling.
 */
function isPrivateTag(tag) {
    const group = parseInt(tag.slice(0, 4), 16);
    const elem = parseInt(tag.slice(4, 8), 16);
    return (group & 1) === 1 && elem >= 0x0010;
}

/** Two-hex-digit uppercase, e.g. 0x10 -> "10". */
function hex2(n) {
    return n.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Block-relative key for a private data element (§18.2): the registered private
 * name when the (creator, offset) is known in the private dictionary and the
 * name is meaningful and non-colliding; otherwise the numeric block-relative
 * offset. Registered names stay scoped to the creator group.
 */
function privateKeyFor(tag, creator, offset, group) {
    const numeric = hex2(offset);
    const reg = lookupPrivateTag(
        `(${tag.slice(0, 4)},"${creator}",${numeric})`
    );
    if (reg && reg.name && reg.name !== "Unknown" && !(reg.name in group)) {
        return reg.name;
    }
    return numeric;
}

/**
 * §16 precision retention (raw-retention default "inexact only", §27). A numeric
 * VR value (IS/DS) decoded to a JS number has lost precision when the number's
 * shortest decimal cannot reproduce the source string (an over-length decimal,
 * or an integer beyond the safe range). In that case retain the original string.
 * This is VR-agnostic: it fires only when a number and its source string
 * disagree, so normal values keep their number.
 */
function retainPrecision(vr, value, raw) {
    if (typeof value !== "number" || typeof raw !== "string") {
        return value;
    }
    const source = raw.trim();
    if (source === "" || !Number.isFinite(value)) {
        return value;
    }
    if (canonicalDecimal(source) === canonicalDecimal(value.toString())) {
        return value; // recoverable from the number -> no loss
    }
    return source;
}

/**
 * Canonical decimal form for comparing whether two decimal strings denote the
 * same number, ignoring formatting (sign, leading/trailing zeros). Exponent
 * notation is left intact, so a number serialized in exponent form that differs
 * from a fixed-notation source compares unequal (conservatively retained).
 */
function canonicalDecimal(s) {
    let str = s.trim().replace(/^\+/, "");
    if (/[eE]/.test(str)) {
        return str;
    }
    let neg = false;
    if (str.startsWith("-")) {
        neg = true;
        str = str.slice(1);
    }
    let [int = "", frac = ""] = str.split(".");
    int = int.replace(/^0+(?=\d)/, "");
    frac = frac.replace(/0+$/, "");
    if (int === "") {
        int = "0";
    }
    const body = frac ? `${int}.${frac}` : int;
    return neg && body !== "0" ? `-${body}` : body;
}

/** Shape a private data value with no VM info: scalar if one value, else array. */
function privateShape(values) {
    if (values.length === 0) {
        return null;
    }
    return values.length === 1 ? values[0] : values.slice();
}

/**
 * Add Person Name accessors (§17): a non-enumerable toString() returning the raw
 * PN string and toJSON() keeping the DICOM JSON model. Component access
 * (`.Alphabetic`) works directly because the value IS the {Alphabetic,...}
 * object (VM 1) or an array of them (VM n). Reuses dcmjs's shared helper.
 */
function addPersonNameAccessors(shaped) {
    if (typeof shaped === "string") {
        shaped = new String(shaped);
    }
    if (shaped && typeof shaped === "object") {
        return dicomJson.pnAddValueAccessors(shaped);
    }
    return shaped;
}

/**
 * A declared VM is "scalar" only when it is exactly "1" or "0-1"; anything else
 * (1-n, 2, 2-n, 3, 6, ...) permits multiple values and is list-like.
 */
function isMultiVM(vm) {
    if (!vm) {
        return false; // unknown tag -> treat as scalar-ish (D1; refined in D2)
    }
    return vm !== "1" && vm !== "0-1";
}
