// Note from dcmjs:
// - This file is based on the decoding functions of https://github.com/cornerstonejs/cornerstoneWADOImageLoader

import jpeg from "jpeg-lossless-decoder-js";
import { mergePixelData } from "../index";

function decodeJPEGLossless(dataset) {
    const byteOutput = dataset.BitsAllocated <= 8 ? 1 : 2;
    // console.time('jpeglossless');
    const buffer = mergePixelData(dataset.PixelData).buffer;
    const decoder = new jpeg.lossless.Decoder();
    const decompressedData = decoder.decode(
        buffer,
        0, // pixelData.byteOffset,
        buffer.byteLength,
        byteOutput
    );
    // console.timeEnd('jpeglossless');

    if (dataset.PixelRepresentation === 0) {
        if (dataset.BitsAllocated === 16) {
            return new Uint16Array(decompressedData.buffer);
        }
        // untested!
        return new Uint8Array(decompressedData.buffer);
    }
    return new Int16Array(decompressedData.buffer);
}

export default decodeJPEGLossless;
