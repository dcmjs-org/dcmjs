// Note from dcmjs:
// - This file is based on the decoding functions of https://github.com/cornerstonejs/cornerstoneWADOImageLoader

/* eslint no-bitwise: 0 */
import { mergePixelData } from "../index";

function swap16(val) {
    return ((val & 0xff) << 8) | ((val >> 8) & 0xff);
}

function decodeBigEndian(dataset) {
    const pixelData = mergePixelData(dataset.PixelData);
    let newPixelData = undefined;
    if (dataset.BitsAllocated === 16) {
        let arrayBuffer = pixelData.buffer;

        let offset = pixelData.byteOffset;
        const length = pixelData.length;
        // if pixel data is not aligned on even boundary, shift it so we can create the 16 bit array
        // buffers on it

        if (offset % 2) {
            arrayBuffer = arrayBuffer.slice(offset);
            offset = 0;
        }

        if (dataset.PixelRepresentation === 0) {
            newPixelData = new Uint16Array(arrayBuffer, offset, length / 2);
        } else {
            newPixelData = new Int16Array(arrayBuffer, offset, length / 2);
        }
        // Do the byte swap
        for (let i = 0; i < newPixelData.length; i++) {
            newPixelData[i] = swap16(newPixelData[i]);
        }
    } else if (dataset.BitsAllocated === 8) {
        newPixelData = pixelData;
    }

    return newPixelData;
}

export default decodeBigEndian;
