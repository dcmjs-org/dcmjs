// src/encapsulated/index.js — the video half of the encapsulated module.
// The PDF half (encapsulatePdf) is in @dcmjs-org/encapsulated.
import {
    videoBase,
    videoPhotographicBase,
    buildVideoDataset,
    encapsulateVideo,
    extractEncapsulatedVideo,
    normalizeFragmentBytes,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES
} from "./encapsulatedVideo.js";

export {
    videoBase,
    videoPhotographicBase,
    buildVideoDataset,
    encapsulateVideo,
    extractEncapsulatedVideo,
    normalizeFragmentBytes,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES
};
