import { initPacked, vrTable, vmTable, nameBlob } from "./dicom.packed.js";

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
