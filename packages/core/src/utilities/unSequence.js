import {
    SEQUENCE_DELIMITER_TAG,
    SEQUENCE_ITEM_TAG,
    UNDEFINED_LENGTH
} from "../constants/dicom.js";
import { isBinaryData } from "./binaryFragment.js";

/**
 * PS3.5 §6.2.2: true when an explicit-VR UN value holds a sequence, encoded
 * as Implicit VR Little Endian. The rule applies only when the dictionary VR
 * `vr` is SQ, or is UN because the tag has no dictionary entry. The value
 * must start with the item tag (FFFE,E000), and the first item length must
 * be undefined or fit in the value. A value of undefined length is always a
 * sequence in §6.2.2: it starts with an item tag, or with the sequence
 * delimiter (FFFE,E0DD) when it is empty. Any other value stays UN bytes.
 *
 * @param {DataView|SplitDataView} view - the bytes, with absolute offsets
 * @param {number} offset - the start of the value
 * @param {number} length - the value length, or UNDEFINED_LENGTH
 * @param {string} vr - the VR after the dictionary lookup
 */
export function isUnSequenceValue(view, offset, length, vr) {
    if (vr !== "UN" && vr !== "SQ") return false;
    const undefinedLength = length === UNDEFINED_LENGTH;
    if (!undefinedLength && length < 8) return false;
    if (offset + 8 > view.byteLength) return false;
    const tag =
        ((view.getUint16(offset, true) << 16) |
            view.getUint16(offset + 2, true)) >>>
        0;
    if (undefinedLength) {
        return tag === SEQUENCE_ITEM_TAG || tag === SEQUENCE_DELIMITER_TAG;
    }
    if (tag !== SEQUENCE_ITEM_TAG) return false;
    const itemLength = view.getUint32(offset + 4, true);
    return itemLength === UNDEFINED_LENGTH || itemLength <= length - 8;
}

/** True for an item dataset: an object whose keys are all tags ("00100010"). */
export function isItemDictLike(v) {
    return (
        v &&
        typeof v === "object" &&
        !isBinaryData(v) &&
        Object.keys(v).every(k => /^[0-9A-Fx]{8,9}$/i.test(k))
    );
}
