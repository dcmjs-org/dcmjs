// packages/imaging/src/h264.js
//
// H.264 profile/level → DICOM transfer syntax mapping. Pure lookup, no codec
// and no MP4 container knowledge — just the rule that says which encapsulated
// transfer syntax can carry a given AVC stream (Supplement 225). Lives in
// imaging because it's shared: video's MP4 header inspection uses it to label
// a stream, and image builders can use it too.

// Fragmentable MPEG-4 AVC/H.264 High Profile transfer syntaxes (Sup 225).
// The fragmentable ".1" family is always chosen because the encapsulation
// writer emits the stream as N >= 1 fragments.
const H264_HIGH_41_FRAGMENTABLE = "1.2.840.10008.1.2.4.102.1";
const H264_HIGH_42_FRAGMENTABLE = "1.2.840.10008.1.2.4.104.1";

// AVC profile_idc values that fit inside the "High Profile" transfer
// syntaxes: Baseline (66) and Main (77) are strict subsets of High (100).
const H264_SUPPORTED_PROFILES = new Set([66, 77, 100]);

/**
 * Map an AVC profile/level pair to the DICOM transfer syntax that carries it,
 * or null when no defined syntax fits (High-10/422/444 profiles, levels above
 * 4.2, HEVC, ...). level_idc is the H.264 level times ten (41 = Level 4.1).
 *
 * @param {number} profileIdc
 * @param {number} levelIdc
 * @returns {string|null}
 */
export function h264TransferSyntaxUID(profileIdc, levelIdc) {
    if (!H264_SUPPORTED_PROFILES.has(profileIdc)) {
        return null;
    }
    if (levelIdc <= 41) {
        return H264_HIGH_41_FRAGMENTABLE;
    }
    if (levelIdc === 42) {
        return H264_HIGH_42_FRAGMENTABLE;
    }
    return null;
}
