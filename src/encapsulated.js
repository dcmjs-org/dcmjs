// @dcmjs-org/dcmjs/encapsulated: the PDF and video wrappers, with the names
// of the dcmjs v2 `encapsulated` namespace.
import { encapsulated } from "@dcmjs-org/media";

export const {
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
} = encapsulated;

export default encapsulated;
