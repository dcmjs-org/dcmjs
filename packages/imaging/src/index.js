// The public surface of @dcmjs-org/imaging: lightweight, codec-free image
// building and header inspection. buildImageDataset turns already-decoded
// pixels into a conformant image instance; parseJpegInfo recovers geometry
// from JPEG bytes without decoding; h264TransferSyntaxUID maps an AVC
// profile/level to its DICOM transfer syntax. Depends only on
// @dcmjs-org/core — the heavy MP4/video processing lives in @dcmjs-org/video.
export {
    buildImageDataset,
    imageBase,
    secondaryCaptureImageBase,
    SECONDARY_CAPTURE_SOP_CLASS_UID
} from "./buildImageDataset.js";
export { parseJpegInfo } from "./jpegInfo.js";
export { h264TransferSyntaxUID } from "./h264.js";
