// src/image/index.js — MP4 header inspection. The codec-free image builders
// (buildImageDataset, parseJpegInfo) and the h264 transfer-syntax mapping now
// live in @dcmjs-org/imaging; only MP4 container parsing stays here.
import { parseMp4Info } from "./mp4Info.js";

export { parseMp4Info };

export default { parseMp4Info };
