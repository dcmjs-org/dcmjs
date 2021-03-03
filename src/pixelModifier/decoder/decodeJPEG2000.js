// Note from dcmjs:
// - This file is based on the decoding functions of https://github.com/cornerstonejs/cornerstoneWADOImageLoader

import OpenJPEG from "../../../libs/openJPEG-FixedMemory-browser.js";
import { mergePixelData } from "../index";

let openJPEG;

function decodeOpenJPEG(data, bytesPerPixel, signed) {
    const dataPtr = openJPEG._malloc(data.length);

    openJPEG.writeArrayToMemory(data, dataPtr);

    // create param outpout
    const imagePtrPtr = openJPEG._malloc(4);
    const imageSizePtr = openJPEG._malloc(4);
    const imageSizeXPtr = openJPEG._malloc(4);
    const imageSizeYPtr = openJPEG._malloc(4);
    const imageSizeCompPtr = openJPEG._malloc(4);

    const t0 = new Date().getTime();
    const ret = openJPEG.ccall(
        "jp2_decode",
        "number",
        ["number", "number", "number", "number", "number", "number", "number"],
        [
            dataPtr,
            data.length,
            imagePtrPtr,
            imageSizePtr,
            imageSizeXPtr,
            imageSizeYPtr,
            imageSizeCompPtr
        ]
    );
    // add num vomp..etc

    if (ret !== 0) {
        console.log("[opj_decode] decoding failed!");
        openJPEG._free(dataPtr);
        openJPEG._free(openJPEG.getValue(imagePtrPtr, "*"));
        openJPEG._free(imageSizeXPtr);
        openJPEG._free(imageSizeYPtr);
        openJPEG._free(imageSizePtr);
        openJPEG._free(imageSizeCompPtr);

        return;
    }

    const imagePtr = openJPEG.getValue(imagePtrPtr, "*");

    const image = {
        length: openJPEG.getValue(imageSizePtr, "i32"),
        sx: openJPEG.getValue(imageSizeXPtr, "i32"),
        sy: openJPEG.getValue(imageSizeYPtr, "i32"),
        nbChannels: openJPEG.getValue(imageSizeCompPtr, "i32"), // hard coded for now
        perf_timetodecode: undefined,
        pixelData: undefined
    };

    // Copy the data from the EMSCRIPTEN heap into the correct type array
    const length = image.sx * image.sy * image.nbChannels;
    const src32 = new Int32Array(openJPEG.HEAP32.buffer, imagePtr, length);

    if (bytesPerPixel === 1) {
        if (Uint8Array.from) {
            image.pixelData = Uint8Array.from(src32);
        } else {
            image.pixelData = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
                image.pixelData[i] = src32[i];
            }
        }
    } else if (signed) {
        if (Int16Array.from) {
            image.pixelData = Int16Array.from(src32);
        } else {
            image.pixelData = new Int16Array(length);
            for (let i = 0; i < length; i++) {
                image.pixelData[i] = src32[i];
            }
        }
    } else if (Uint16Array.from) {
        image.pixelData = Uint16Array.from(src32);
    } else {
        image.pixelData = new Uint16Array(length);
        for (let i = 0; i < length; i++) {
            image.pixelData[i] = src32[i];
        }
    }

    const t1 = new Date().getTime();

    image.perf_timetodecode = t1 - t0;

    // free
    openJPEG._free(dataPtr);
    openJPEG._free(imagePtrPtr);
    openJPEG._free(imagePtr);
    openJPEG._free(imageSizePtr);
    openJPEG._free(imageSizeXPtr);
    openJPEG._free(imageSizeYPtr);
    openJPEG._free(imageSizeCompPtr);

    return image;
}

function decodeOpenJpeg2000(imageFrame, pixelData) {
    const bytesPerPixel = imageFrame.bitsAllocated <= 8 ? 1 : 2;
    const signed = imageFrame.pixelRepresentation === 1;

    const image = decodeOpenJPEG(pixelData, bytesPerPixel, signed);

    imageFrame.Columns = image.sx;
    imageFrame.Rows = image.sy;
    imageFrame.PixelData = image.pixelData;
    if (image.nbChannels > 1) {
        imageFrame.photometricInterpretation = "RGB";
    }

    return image.pixelData;
}

function initializeJPEG2000() {
    if (!openJPEG) {
        openJPEG = OpenJPEG();
        if (!openJPEG || !openJPEG._jp2_decode) {
            throw new Error("OpenJPEG failed to initialize");
        }
    }
}

function decodeJPEG2000(dataset, decodeConfig = {}) {
    initializeJPEG2000(decodeConfig);

    // OpenJPEG2000 https://github.com/jpambrun/openjpeg
    return decodeOpenJpeg2000(dataset, mergePixelData(dataset.PixelData));
}

export default decodeJPEG2000;
export { initializeJPEG2000 };
