import { getNameByTransferSyntaxUid } from "../index";
import { InvalidDicomFileError, NotSupportedUidError } from "../errors";

import decodeJPEGBaseline from "./decodeJPEGBaseline";
import decodeJPEGLossless from "./decodeJPEGLossless";
import decodeJPEGLS from "./decodeJPEGLS";
import decodeJPEG2000 from "./decodeJPEG2000";
import decodeRLE from "./decodeRLE";
import decodeBigEndian from "./decodeBigEndian";
import decodeLittleEndian from "./decodeLittleEndian";

export default class Decoder {
    /**
     * Create a Decoder object
     * @param {Object} dataset - Naturalized DICOM dataset
     */
    constructor(dataset) {
        this.dataset = dataset;
    }

    /**
     * Decodes pixel data and return decoded pixel data
     * @returns {Object} Uint8Array (or other types)
     */
    decode() {
        const transferSyntaxUid = this.dataset.TransferSyntaxUID;
        if (!transferSyntaxUid) {
            throw new InvalidDicomFileError("TransferSyntaxUid is empty");
        }

        const transferSyntaxName = getNameByTransferSyntaxUid(
            transferSyntaxUid
        );

        // TODO: delete
        console.log(
            `TransferSyntaxUID : ${transferSyntaxUid}, ${transferSyntaxName}`
        );

        const funcName = `decode${transferSyntaxName}`;

        if (typeof this[funcName] === "function") {
            return this[funcName].call(this);
        }

        throw new NotSupportedUidError(
            `The transfer syntax uid ${transferSyntaxUid} is not supported`
        );
    }

    /**
     * Decode Implicit VR Little Endian typed pixel
     * 1.2.840.10008.1.2
     */
    decodeImplicitVRLittleEndian() {
        return decodeLittleEndian(this.dataset);
    }

    /**
     * Decode Explicit VR Little Endian
     * 1.2.840.10008.1.2.1
     */
    decodeExplicitVRLittleEndian() {
        return decodeLittleEndian(this.dataset);
    }

    /**
     * Decode Deflated Explicit VR Little Endian
     * 1.2.840.10008.1.2.1.99
     */
    decodeDeflatedExplicitVRLittleEndian() {
        return decodeLittleEndian(this.dataset);
    }

    /**
     * Decode Explicit VR Big Endian (Retired)
     * 1.2.840.10008.1.2.2
     */
    decodeExplicitVRBigEndian() {
        return decodeBigEndian(this.dataset);
    }

    /**
     * Decode JPEG Baseline (Process 1): Default Transfer Syntax for Lossy JPEG 8 Bit Image Compression
     * 1.2.840.10008.1.2.4.50
     */
    decodeJPEGBaseline8Bit() {
        return decodeJPEGBaseline(this.dataset);
    }

    /**
     * Decode JPEG Extended (Process 2 & 4): Default Transfer Syntax for Lossy JPEG 12 Bit Image Compression (Process 4 only)
     * 1.2.840.10008.1.2.4.51
     */
    decodeJPEGExtended12Bit() {
        return decodeJPEGBaseline(this.dataset);
    }

    /**
     * Decode JPEG Lossless, Non-Hierarchical (Process 14)
     * 1.2.840.10008.1.2.4.57
     */
    decodeJPEGLossless() {
        return decodeJPEGLossless(this.dataset);
    }

    /**
     * Decode JPEG Lossless, Non-Hierarchical, First-Order Prediction (Process 14 [Selection Value 1]): Default Transfer Syntax for Lossless JPEG Image Compression
     * 1.2.840.10008.1.2.4.70
     */
    decodeJPEGLosslessSV1() {
        return decodeJPEGLossless(this.dataset);
    }

    /**
     * Decode JPEG-LS Lossless Image Compression
     * 1.2.840.10008.1.2.4.80
     */
    decodeJPEGLSLossless() {
        return decodeJPEGLS(this.dataset);
    }

    /**
     * Decode JPEG-LS Lossy (Near-Lossless) Image Compression
     * 1.2.840.10008.1.2.4.81
     */
    decodeJPEGLSNearLossless() {
        return decodeJPEGLS(this.dataset);
    }

    /**
     * Decode JPEG 2000 Image Compression (Lossless Only)
     * 1.2.840.10008.1.2.4.90
     */
    decodeJPEG2000Lossless() {
        return decodeJPEG2000(this.dataset);
    }

    /**
     * Decode JPEG 2000 Image Compression
     * 1.2.840.10008.1.2.4.91
     */
    decodeJPEG2000() {
        return decodeJPEG2000(this.dataset);
    }

    /**
     * Decode RLE Lossless
     * 1.2.840.10008.1.2.5
     */
    decodeRLELossless() {
        return decodeRLE(this.dataset);
    }
}
