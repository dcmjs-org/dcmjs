// The @dcmjs-org/media bundle: one dependency for the three bulk-data
// surfaces — DICOMDIR building (@dcmjs-org/dicomdir), Encapsulated PDF
// wrapping (@dcmjs-org/pdfs), and video/image encapsulation
// (@dcmjs-org/video) — re-exported under the namespace shapes of dcmjs
// v2's src/index.js (`media`, `encapsulated`, `image`), so a consumer of
// `dcmjs.media` / `dcmjs.encapsulated` / `dcmjs.image` reads the same
// names here.
import {
    buildDicomDirDataset,
    writeDicomDir,
    MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID
} from "@dcmjs-org/dicomdir";
import {
    encapsulatePdf,
    extractEncapsulatedPdf,
    ENCAPSULATED_PDF_SOP_CLASS_UID
} from "@dcmjs-org/pdfs";
import {
    buildVideoDataset,
    encapsulateVideo,
    extractEncapsulatedVideo,
    normalizeFragmentBytes,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES,
    buildImageDataset,
    SECONDARY_CAPTURE_SOP_CLASS_UID,
    parseJpegInfo,
    parseMp4Info,
    h264TransferSyntaxUID,
    createVideoEventSource
} from "@dcmjs-org/video";

// Media storage (PS3.10): the DICOMDIR builder — dcmjs v2's `media` namespace.
export const media = {
    buildDicomDirDataset,
    writeDicomDir,
    MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID
};

// Encapsulated payloads (PDF and video, in and out) — v2's `encapsulated`.
export const encapsulated = {
    encapsulatePdf,
    extractEncapsulatedPdf,
    ENCAPSULATED_PDF_SOP_CLASS_UID,
    buildVideoDataset,
    encapsulateVideo,
    extractEncapsulatedVideo,
    normalizeFragmentBytes,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES
};

// Image instances from decoded pixels (codec-free) — v2's `image`.
export const image = {
    buildImageDataset,
    SECONDARY_CAPTURE_SOP_CLASS_UID,
    parseJpegInfo,
    parseMp4Info,
    h264TransferSyntaxUID
};

// The streaming MP4 → events source has no v2 namespace; it rides along
// as a named export for event-stream consumers.
export { createVideoEventSource };

export default { media, encapsulated, image, createVideoEventSource };
