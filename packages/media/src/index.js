// The @dcmjs-org/media bundle: one dependency for the bulk-data surfaces —
// DICOMDIR building (@dcmjs-org/dicomdir), Encapsulated PDF wrapping
// (@dcmjs-org/encapsulated), image building (@dcmjs-org/imaging), and video
// encapsulation (@dcmjs-org/video) — re-exported under the namespace shapes
// of dcmjs v2's src/index.js (`media`, `encapsulated`, `image`), so a
// consumer of `dcmjs.media` / `dcmjs.encapsulated` / `dcmjs.image` reads the
// same names here. The builders take the createInstance options of
// @dcmjs-org/core; the base blocks ride along for a custom `baseDicom`.
import {
    buildDicomDirDataset,
    writeDicomDir,
    MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID
} from "@dcmjs-org/dicomdir";
import {
    encapsulate,
    encapsulatedBase,
    encapsulatePdf,
    encapsulatedPdfBase,
    extractEncapsulatedPdf,
    ENCAPSULATED_PDF_SOP_CLASS_UID,
    PDF_MIME_TYPE
} from "@dcmjs-org/encapsulated";
import {
    buildImageDataset,
    imageBase,
    derivedImageBase,
    SECONDARY_CAPTURE_SOP_CLASS_UID,
    parseJpegInfo,
    h264TransferSyntaxUID
} from "@dcmjs-org/imaging";
import {
    buildVideoDataset,
    videoBase,
    encapsulateVideo,
    extractEncapsulatedVideo,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES,
    parseMp4Info,
    createVideoEventSource
} from "@dcmjs-org/video";

// Media storage (PS3.10): the DICOMDIR builder — dcmjs v2's `media` namespace.
export const media = {
    buildDicomDirDataset,
    writeDicomDir,
    MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID
};

// Encapsulated payloads (documents and video, in and out) — v2's
// `encapsulated`.
export const encapsulated = {
    encapsulate,
    encapsulatedBase,
    encapsulatePdf,
    encapsulatedPdfBase,
    extractEncapsulatedPdf,
    ENCAPSULATED_PDF_SOP_CLASS_UID,
    PDF_MIME_TYPE,
    buildVideoDataset,
    videoBase,
    encapsulateVideo,
    extractEncapsulatedVideo,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES
};

// Image instances from decoded pixels (codec-free) — v2's `image`.
export const image = {
    buildImageDataset,
    imageBase,
    derivedImageBase,
    SECONDARY_CAPTURE_SOP_CLASS_UID,
    parseJpegInfo,
    parseMp4Info,
    h264TransferSyntaxUID
};

// The streaming MP4 → events source has no v2 namespace; it rides along
// as a named export for event-stream consumers.
export { createVideoEventSource };

export default { media, encapsulated, image, createVideoEventSource };
