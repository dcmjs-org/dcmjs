// Note from dcmjs:
// - This file is based on the decoding functions of https://github.com/cornerstonejs/cornerstoneWADOImageLoader

function _decodeLittleEndian(dataset, arrayBuffer) {
    let offset = 0;
    const length = arrayBuffer.byteLength;
    let pixelData = undefined;
    if (dataset.BitsAllocated === 16) {
        if (dataset.PixelRepresentation === 0) {
            pixelData = new Uint16Array(arrayBuffer, offset, length / 2);
        } else {
            pixelData = new Int16Array(arrayBuffer, offset, length / 2);
        }
    } else if (dataset.BitsAllocated === 8 || dataset.BitsAllocated === 1) {
        pixelData = new Uint8Array(arrayBuffer);
    } else if (dataset.BitsAllocated === 32) {
        pixelData = new Float32Array(arrayBuffer, offset, length / 4);
    }

    return pixelData;
}

function decodeLittleEndian(dataset) {
    if (Array.isArray(dataset.PixelData)) {
        return dataset.PixelData.map(arrayBuffer =>
            _decodeLittleEndian(dataset, arrayBuffer)
        );
    } else {
        return _decodeLittleEndian(dataset, dataset.PixelData);
    }
}

export default decodeLittleEndian;
