// The public surface of @dcmjs-org/video.
//
// Header inspection (parseJpegInfo, parseMp4Info) recovers the geometry and
// timing DICOM needs from JPEG/MP4 bytes WITHOUT decoding any pixels, so the
// compressed stream can travel into encapsulated PixelData verbatim. The
// dataset builders and the video event source land in later slices of this
// package.
export * from "./image/index.js";
