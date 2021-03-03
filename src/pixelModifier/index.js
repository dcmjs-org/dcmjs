import { DicomDict } from "../DicomDict";
import Decoder from "./decoder";
import {
    IllegalArgumentsError,
    NotSupportedUidError,
    NoDecodedPixelError,
    NoEncodedPixelError
} from "./errors";
import { DicomMetaDictionary } from "../DicomMetaDictionary";
import Encoder from "./encoder";

/**
 * refer to http://dicom.nema.org/medical/dicom/current/output/html/part06.html#table_A-1 for full list of transfer syntax uids
 */
export const SUPPORTED_TRANSFER_SYNTAX_UIDS = {
    ImplicitVRLittleEndian: "1.2.840.10008.1.2", // Implicit VR Little Endian: Default Transfer Syntax for DICOM
    ExplicitVRLittleEndian: "1.2.840.10008.1.2.1", // Explicit VR Little Endian
    DeflatedExplicitVRLittleEndian: "1.2.840.10008.1.2.1.99", // Deflated Explicit VR Little Endian
    ExplicitVRBigEndian: "1.2.840.10008.1.2.2", // 	Explicit VR Big Endian (Retired)
    JPEGBaseline8Bit: "1.2.840.10008.1.2.4.50", // JPEG Baseline (Process 1): Default Transfer Syntax for Lossy JPEG 8 Bit Image Compression
    JPEGExtended12Bit: "1.2.840.10008.1.2.4.51", // JPEG Extended (Process 2 & 4): Default Transfer Syntax for Lossy JPEG 12 Bit Image Compression (Process 4 only)
    JPEGLossless: "1.2.840.10008.1.2.4.57", // JPEG Lossless, Non-Hierarchical (Process 14)
    JPEGLosslessSV1: "1.2.840.10008.1.2.4.70", // JPEG Lossless, Non-Hierarchical, First-Order Prediction (Process 14 [Selection Value 1]): Default Transfer Syntax for Lossless JPEG Image Compression
    JPEGLSLossless: "1.2.840.10008.1.2.4.80", // JPEG-LS Lossless Image Compression
    JPEGLSNearLossless: "1.2.840.10008.1.2.4.81", // JPEG-LS Lossy (Near-Lossless) Image Compression
    JPEG2000Lossless: "1.2.840.10008.1.2.4.90", // JPEG 2000 Image Compression (Lossless Only)
    JPEG2000: "1.2.840.10008.1.2.4.91", // JPEG 2000 Image Compression
    RLELossless: "1.2.840.10008.1.2.5" // RLE Lossless
};

/**
 * This map will be constructed dynamically when first used
 * @type {{}}
 */
const SUPPORTED_TRANSFER_SYNTAX_UID_NAMES = {};

/**
 * Retrieve its name by Transfer Syntax UID
 * @param {string} the name of the transfer syntax UID
 */
export function getNameByTransferSyntaxUid(transferSyntaxUid) {
    if (Object.keys(SUPPORTED_TRANSFER_SYNTAX_UID_NAMES).length === 0) {
        Object.keys(SUPPORTED_TRANSFER_SYNTAX_UIDS).forEach(name => {
            const uid = SUPPORTED_TRANSFER_SYNTAX_UIDS[name];
            SUPPORTED_TRANSFER_SYNTAX_UID_NAMES[uid] = name;
        });
    }
    return SUPPORTED_TRANSFER_SYNTAX_UID_NAMES[transferSyntaxUid];
}

export function mergePixelData(arrayBuffer) {
    if (Array.isArray(arrayBuffer)) {
        const byteLength = arrayBuffer.reduce((p, c) => p + c.byteLength, 0);
        const pixelData = new Uint8Array(byteLength);
        let offset = 0;
        for (let i = 0; i < arrayBuffer.length; ++i) {
            pixelData.set(new Uint8Array(arrayBuffer[i]), offset);
            offset += arrayBuffer[i].byteLength;
        }
        return pixelData;
    } else {
        return new Uint8Array(arrayBuffer);
    }
}

/**
 * Class that provides methods that modifies pixel data
 */
export default class PixelModifier {
    /**
     * Create a PixelModifier object
     * @param {Object} dicomDict - DICOM JSON format object
     * @param {Object} options - options object
     * @param {Object} keepTransferSyntaxUID - true if you want to keep transfer syntax uid after modification
     */
    constructor(dicomDict, options = {}) {
        this.dicomDict = dicomDict;
        this._initOptions(options);
        this._validate();

        // naturalize dicomDict so that the properties of the dictionary can be easily retrieved.
        this.dataset = Object.assign(
            DicomMetaDictionary.naturalizeDataset(dicomDict.meta),
            DicomMetaDictionary.naturalizeDataset(dicomDict.dict)
        );

        this._clearPixelDataInProgress();
    }

    /**
     * Initialize options
     * @param options
     * @private
     */
    _initOptions(options) {
        this.options = options || {};
        if (this.options.keepTransferSyntaxUID === undefined) {
            this.options.keepTransferSyntaxUID = false;
        }
    }

    /**
     * Perform a basic validation to see if the dicomDict is valid for pixel modification
     * @private
     */
    _validate() {
        const dicomDict = this.dicomDict;
        if (!(dicomDict instanceof DicomDict)) {
            throw new IllegalArgumentsError(`dicomDict is not valid`);
        }

        const transferSyntaxUid = dicomDict.meta["00020010"].Value[0];
        if (
            !Object.values(SUPPORTED_TRANSFER_SYNTAX_UIDS).includes(
                transferSyntaxUid
            )
        ) {
            throw new NotSupportedUidError(
                `The transfer syntax uid ${transferSyntaxUid} is not supported`
            );
        }
    }

    /**
     * Clear interim pixel data
     * @private
     */
    _clearPixelDataInProgress() {
        this.decodedPixelData = undefined;
        this.encodedPixelData = undefined;
    }

    /**
     * Decode pixel data
     */
    decode() {
        const decoder = new Decoder(this.dataset);
        this.decodedPixelData = decoder.decode();
        if (!this.decodedPixelData) {
            throw new NoDecodedPixelError("no decoded pixel data");
        }
    }

    /**
     * Encode pixel data
     */
    encode() {
        const encoder = new Encoder(this.dataset);
        this.encodedPixelData = encoder.encode();
        if (!this.encodedPixelData) {
            throw NoEncodedPixelError("no encoded pixel data");
        }
    }

    /**
     * Draw a shape given on top of the pixel data
     * @param {String} shape - a string of supported shapes
     * @param {*} shapeOptions - a spefic options for the given shape
     * @param {*} fill
     */
    draw(shape, shapeOptions, fill = PixelModifier.FILLS.solid) {
        // Decode pixel data if needed
        this.decode();

        // Draw a shape on the decoded pixel data
        switch (shape) {
            case PixelModifier.SHAPES.rectangle:
                this.drawRectangle(shapeOptions, fill);
                break;

            default:
                throw new IllegalArgumentsError(
                    `${shape} is not a supported shape`
                );
        }

        // Encode pixel data if needed
        if (this.options.keepTransferSyntaxUID) {
            this.encode();
        }

        this.applyPixelDataToDicomDict();

        this._clearPixelDataInProgress();
    }

    /**
     * Apply changed pixel data (either decoded or encoded) to dicomDict
     */
    applyPixelDataToDicomDict() {
        let pixelData = undefined;
        if (this.options.keepTransferSyntaxUID) {
            pixelData = this.encodedPixelData;
        } else {
            // Set TransferSyntaxUID
            this.dicomDict.meta["00020010"].Value = [
                SUPPORTED_TRANSFER_SYNTAX_UIDS.ExplicitVRLittleEndian
            ];

            pixelData = this.decodedPixelData;
        }

        // Set Pixel Data
        if (Array.isArray(pixelData)) {
            this.dicomDict.dict["7FE00010"].Value = [
                mergePixelData(
                    pixelData.map(unitPixelData => unitPixelData.buffer)
                ).buffer
            ];
        } else {
            this.dicomDict.dict["7FE00010"].Value = [pixelData.buffer];
        }
    }

    /**
     * Draw a rectangle
     * @param {Object} options
     * @param {number} options.left
     * @param {number} options.top
     * @param {number} options.right
     * @param {number} options.bottom
     * @param {string} fill
     */
    drawRectangle(options = {}, fill = PixelModifier.FILLS.solid) {
        let { left = 0, top = 0, right = 0, bottom = 0 } = options;

        console.log(`drawing (${left}, ${top}, ${right}, ${bottom})`);

        const [width, height] = this.getSizeOfImage();
        const samplesPerPixel = this.dataset.SamplesPerPixel || 1;
        const decodedPixelData = this.decodedPixelData;
        if (left > width || top > height) {
            return;
        }

        right = right > width ? width : right;
        bottom = bottom > height ? height : bottom;

        if (Array.isArray(decodedPixelData)) {
            decodedPixelData.forEach(unitPixelData =>
                this._drawRectangle(
                    unitPixelData,
                    samplesPerPixel,
                    width,
                    left,
                    top,
                    right,
                    bottom
                )
            );
        } else {
            this._drawRectangle(
                decodedPixelData,
                samplesPerPixel,
                width,
                left,
                top,
                right,
                bottom
            );
        }
    }

    _drawRectangle(
        pixelData,
        samplesPerPixel,
        width,
        left,
        top,
        right,
        bottom
    ) {
        const darkestValue = this.getDarkestValue();
        for (let i = top; i < bottom; ++i) {
            const offset = (width * i + left) * samplesPerPixel;
            const limit = offset + (right - left) * samplesPerPixel;
            for (let j = offset; j < limit; ++j) {
                pixelData[j] = darkestValue;
            }
        }
    }

    getDarkestValue() {
        if (this.dataset.PixelPaddingValue !== undefined) {
            return this.dataset.PixelPaddingValue;
        }
        const photometricInterpretation = this.getPhotometricInterpretation();
        if (photometricInterpretation === "MONOCHROME1") {
            return (
                ((1 << this.dataset.BitsAllocated) - 1) >>
                (this.dataset.BitsAllocated - this.dataset.BitsStored)
            );
        } else {
            return 0x00;
        }
    }

    getPhotometricInterpretation() {
        return this.dataset.PhotometricInterpretation;
    }

    getSizeOfImage() {
        return [this.dataset.Columns, this.dataset.Rows];
    }

    getSampleBytes() {
        return this.dataset.BitsAllocated / 8;
    }
}

PixelModifier.SHAPES = {
    rectangle: "rectangle"
};

PixelModifier.FILLS = {
    solid: "solid"
};
