/**
 * The binary (byte-stream) VRs. A binary Value lists frames or fragments,
 * not a VM, so a naturalized binary value stays a list regardless of the
 * dictionary VM.
 */
const BINARY_VRS = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "UN"]);

export default BINARY_VRS;
