// The public surface of @dcmjs-org/video.
//
// parseMp4Info walks an MP4's moov box to recover the geometry and timing
// DICOM needs WITHOUT decoding any pixels, so the compressed stream can travel
// into encapsulated PixelData verbatim. The encapsulated module wraps an MP4's
// H.264 stream into a Video Photographic Image instance (and recovers it
// byte-identically). createVideoEventSource is the streaming path: MP4 →
// contract events, one fragment in memory at a time, for any event-stream sink.
//
// Codec-free image building (buildImageDataset) and JPEG/H.264 header
// inspection live in @dcmjs-org/imaging; this package depends on it.
export * from "./image/index.js";
export * from "./encapsulated/index.js";
export { createVideoEventSource } from "./eventStream/fromVideo.js";
