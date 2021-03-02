import { InvalidDicomFileError, NotSupportedUidError } from "../errors";
import { getNameByTransferSyntaxUid } from "../index";

export default class Encoder {
    /**
     * Create a Encoder object
     * @param {Object} dataset - Naturalized DICOM dataset
     */
    constructor(dataset) {
        this.dataset = dataset;
    }

    encode() {
        const transferSyntaxUid = this.dataset.TransferSyntaxUID;
        if (!transferSyntaxUid) {
            throw new InvalidDicomFileError("TransferSyntaxUid is empty");
        }

        // TODO: delete
        console.log(`TransferSyntaxUID to encode : ${transferSyntaxUid}`);

        const funcName = `encode${getNameByTransferSyntaxUid(
            transferSyntaxUid
        )}`;

        if (typeof this[funcName] === "function") {
            return this[funcName].call(this);
        }

        throw new NotSupportedUidError(
            `The transfer syntax uid ${transferSyntaxUid} is not supported`
        );
    }

    /**
     * Encode Implicit VR Little Endian typed pixel
     */
    encodeImplicitVRLittleEndian() {
        console.log("encodeImplicitVRLittleEndian");
    }

    /**
     * Encode Explicit VR Little Endian
     */
    encodeExplicitVRLittleEndian() {
        console.log("encodeExplicitVRLittleEndian");
    }

    /**
     * Encode Deflated Explicit VR Little Endian
     */
    encodeDeflatedExplicitVRLittleEndian() {
        console.log("encodeDeflatedExplicitVRLittleEndian");
    }

    /**
     * Encode Explicit VR Big Endian (Retired)
     */
    encodeExplicitVRBigEndian() {
        console.log("encodeExplicitVRBigEndian");
    }

    /**
     * Encode JPEG Baseline (Process 1): Default Transfer Syntax for Lossy JPEG 8 Bit Image Compression
     */
    encodeJPEGBaseline8Bit() {
        console.log("encodeJPEGBaseline8Bit");
    }

    /**
     * Encode JPEG Extended (Process 2 & 4): Default Transfer Syntax for Lossy JPEG 12 Bit Image Compression (Process 4 only)
     */
    encodeJPEGExtended12Bit() {
        console.log("encodeJPEGExtended12Bit");
    }

    /**
     * Encode JPEG Lossless, Non-Hierarchical (Process 14)
     */
    encodeJPEGLossless() {
        console.log("encodeJPEGLossless");
    }

    /**
     * Encode JPEG Lossless, Non-Hierarchical, First-Order Prediction (Process 14 [Selection Value 1]): Default Transfer Syntax for Lossless JPEG Image Compression
     */
    encodeJPEGLosslessSV1() {
        console.log("encodeJPEGLosslessSV1");
    }

    /**
     * Encode JPEG-LS Lossless Image Compression
     */
    encodeJPEGLSLossless() {
        console.log("encodeJPEGLSLossless");
    }

    /**
     * Encode JPEG-LS Lossy (Near-Lossless) Image Compression
     */
    encodeJPEGLSNearLossless() {
        console.log("encodeJPEGLSNearLossless");
    }

    /**
     * Encode JPEG 2000 Image Compression (Lossless Only)
     */
    encodeJPEG2000Lossless() {
        console.log("encodeJPEG2000Lossless");
    }

    /**
     * Encode JPEG 2000 Image Compression
     */
    encodeJPEG2000() {
        console.log("encodeJPEG2000");
    }

    /**
     * Encode RLE Lossless
     */
    encodeRLELossless() {
        console.log("encodeRLELossless");
    }
}
