// The public surface of @dcmjs-org/video.
//
// Header inspection (parseJpegInfo, parseMp4Info) recovers the geometry and
// timing DICOM needs from JPEG/MP4 bytes WITHOUT decoding any pixels, so the
// compressed stream can travel into encapsulated PixelData verbatim.
// buildImageDataset turns already-decoded pixels into a conformant image
// instance, and the encapsulated module wraps an MP4's H.264 stream into a
// Video Photographic Image instance (and recovers it byte-identically).
// createVideoEventSource is the streaming path: MP4 → contract events, one
// fragment in memory at a time, for any event-stream sink.
export * from "./image/index.js";
export * from "./encapsulated/index.js";
export { createVideoEventSource } from "./eventStream/fromVideo.js";
