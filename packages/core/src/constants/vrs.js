/**
 * The classification of each VR, stored once. ValueRepresentation copies
 * the flags to each instance; singleVRs and BINARY_VRS are computed here.
 * OV has flags but no VR class in 1.0.
 * @typedef {Object} VrFlags
 * @property {boolean} [binary] binary number or tag: isBinary()
 * @property {boolean} [length32] 32-bit explicit VR length: isLength32()
 * @property {boolean} [single] never joined on write: !allowMultiple()
 * @property {boolean} [readSingle] never split on read: singleVRs
 * @property {boolean} [byteStream] frames/fragments, not a VM: BINARY_VRS
 */
const SEED = {
    AT: "binary",
    FD: "binary",
    FL: "binary",
    LT: "readSingle",
    OB: "length32 single readSingle byteStream",
    OD: "length32 byteStream",
    OF: "length32 single readSingle byteStream",
    OL: "length32 single byteStream",
    OV: "byteStream",
    OW: "length32 single readSingle byteStream",
    SL: "binary",
    SQ: "length32 single readSingle",
    SS: "binary",
    UC: "length32",
    UL: "binary",
    UN: "length32 single readSingle byteStream",
    UR: "length32",
    US: "binary",
    UT: "length32",
    UV: "binary length32"
};

/** @type {Object<string, VrFlags>} */
export const vrFlags = Object.fromEntries(
    Object.entries(SEED).map(([code, names]) => [
        code,
        Object.fromEntries(names.split(" ").map(name => [name, true]))
    ])
);

function codesWith(flag) {
    return Object.keys(vrFlags).filter(code => vrFlags[code][flag]);
}

/** VRs whose read value is never VM-split on backslashes. */
export const singleVRs = codesWith("readSingle");

/** Byte-stream VRs: a naturalized value stays a list of frames/fragments. */
export const BINARY_VRS = new Set(codesWith("byteStream"));

/** Replaces the flags of a code; the two views above update in place. */
export function setVrFlags(code, flags) {
    vrFlags[code] = { ...flags };
    singleVRs.splice(0, singleVRs.length, ...codesWith("readSingle"));
    BINARY_VRS.clear();
    codesWith("byteStream").forEach(c => BINARY_VRS.add(c));
}
