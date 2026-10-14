import { initPacked, vrTable, vmTable, nameBlob } from "./dicom.packed.js";
import { rangeEntries } from "./dictionary.ranges.data.js";

let _groupIndex;
function _ensureGroupIndex(groups) {
    if (_groupIndex) return _groupIndex;
    const m = new Map();
    for (let i = 0; i < groups.length; i++) m.set(groups[i], i);
    _groupIndex = m;
    return m;
}

function _binSearchU16(arr, start, end, target) {
    let lo = start,
        hi = end - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const v = arr[mid];
        if (v < target) lo = mid + 1;
        else if (v > target) hi = mid - 1;
        else return mid;
    }
    return -1;
}

export function lookupTagHex(hex8) {
    // hex8 like '00080005'
    if (typeof hex8 !== "string" || hex8.length !== 8) return undefined;
    const group = parseInt(hex8.slice(0, 4), 16);
    const elem = parseInt(hex8.slice(4, 8), 16);
    if (!Number.isFinite(group) || !Number.isFinite(elem)) return undefined;

    const { groups, groupStart, elems, vrCode, vmCode, nameOff, nameLen } =
        initPacked();
    const gi = _ensureGroupIndex(groups).get(group);
    if (gi === undefined) return undefined;

    const start = groupStart[gi];
    const end = gi + 1 < groupStart.length ? groupStart[gi + 1] : elems.length;
    const ei = _binSearchU16(elems, start, end, elem);
    if (ei < 0) return undefined;

    const vr = vrTable[vrCode[ei]];
    const vm = vmTable[vmCode[ei]];
    const off = nameOff[ei];
    const len = nameLen[ei];
    const name = nameBlob.slice(off, off + len);

    return { vr, vm, name };
}

/**
 * Look up a tag by hex8 (e.g. '50010005') in the range dictionary (repeating groups 50xx, 60xx, etc.).
 * Returns undefined if the tag does not fall within any defined range.
 */
export function lookupTagRangeHex(hex8) {
    if (typeof hex8 !== "string" || hex8.length !== 8) return undefined;
    const group = parseInt(hex8.slice(0, 4), 16);
    const elem = parseInt(hex8.slice(4, 8), 16);
    if (!Number.isFinite(group) || !Number.isFinite(elem)) return undefined;
    for (let i = 0; i < rangeEntries.length; i++) {
        const r = rangeEntries[i];
        if (group >= r.groupMin && group <= r.groupMax && elem === r.elem) {
            return { vr: r.vr, vm: r.vm, name: r.name };
        }
    }
    return undefined;
}

function _pad4(hex) {
    return ("0000" + hex).slice(-4);
}

/**
 * Yields all standard (packed + range) tag entries for building nameMap.
 * Each entry has { tag, vr, vm, name } with tag as "(GGGG,EEEE)".
 */
export function getAllStandardTagEntries() {
    const out = [];
    const { groups, groupStart, elems, vrCode, vmCode, nameOff, nameLen } =
        initPacked();
    for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        const start = groupStart[gi];
        const end =
            gi + 1 < groupStart.length ? groupStart[gi + 1] : elems.length;
        const gHex = _pad4(group.toString(16).toUpperCase());
        for (let ei = start; ei < end; ei++) {
            const elem = elems[ei];
            const eHex = _pad4(elem.toString(16).toUpperCase());
            const tag = "(" + gHex + "," + eHex + ")";
            const vr = vrTable[vrCode[ei]];
            const vm = vmTable[vmCode[ei]];
            const off = nameOff[ei];
            const len = nameLen[ei];
            const name = nameBlob.slice(off, off + len);
            out.push({ tag, vr, vm, name });
        }
    }
    for (let i = 0; i < rangeEntries.length; i++) {
        const r = rangeEntries[i];
        const gHex = _pad4(r.groupMin.toString(16).toUpperCase());
        const eHex = _pad4(r.elem.toString(16).toUpperCase());
        const tag = "(" + gHex + "," + eHex + ")";
        out.push({ tag, vr: r.vr, vm: r.vm, name: r.name });
    }
    return out;
}
