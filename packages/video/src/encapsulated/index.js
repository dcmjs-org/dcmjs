// src/encapsulated/index.js — the video half of the encapsulated module.
// The PDF half (encapsulatedPdf) belongs to the media wave, not this package.
import {
    buildVideoDataset,
    encapsulateVideo,
    extractEncapsulatedVideo,
    normalizeFragmentBytes,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES
} from "./encapsulatedVideo.js";

export {
    buildVideoDataset,
    encapsulateVideo,
    extractEncapsulatedVideo,
    normalizeFragmentBytes,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES
};
