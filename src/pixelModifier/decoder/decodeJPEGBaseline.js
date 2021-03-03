// Note from dcmjs:
// - This file is based on the decoding functions of https://github.com/cornerstonejs/cornerstoneWADOImageLoader

import JpegImage from "../../../libs/jpeg.js";
// import { mergePixelData } from "../index";

function decodeJPEGBaseline(dataset) {
    // const pixelData =  mergePixelData(dataset.PixelData);
    // return _decodeJPEGBaseline(dataset, pixelData);Z

    if (Array.isArray(dataset.PixelData)) {
        return dataset.PixelData.map(pixelData =>
            _decodeJPEGBaseline(dataset, new Uint8Array(pixelData))
        );
    } else {
        return _decodeJPEGBaseline(dataset, new Uint8Array(dataset.PixelData));
    }
}

/**
 *
 * @param pixelData ArrayBuffer - pixel data
 * @private
 */
function _decodeJPEGBaseline(dataset, pixelData) {
    const jpeg = new JpegImage();
    jpeg.parse(pixelData);
    // jpeg.colorTransform = false;

    if (dataset.BitsAllocated === 8) {
        return jpeg.getData(dataset.Columns, dataset.Rows);
    } else if (dataset.BitsAllocated === 16) {
        return jpeg.getData16(dataset.Columns, dataset.Rows);
    }
}

export default decodeJPEGBaseline;
