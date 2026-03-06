import { DicomMetaDictionary } from "./DicomMetaDictionary";
import { defaultEncoding } from "./constants/encodings";
import { selectNativeEncoding } from "./utilities/selectEncoding";

/**
 * Facilitates the conversion of binary buffers from a DICOM encoding scheme to
 * a web supported string encoding scheme and vice versa.
 */
export class DicomBufferCODEC {
    encoder = new TextEncoder(defaultEncoding);
    decoder = new TextDecoder(defaultEncoding);

    /**
     * Use this method if you want to change the decoder directly and do not
     * need to have the encoding scheme name translated to one of the encoding
     * schemes supported by web browsers.
     *
     * For example, instead of passing ISO 2022 IR 100, you have to pass latin1.
     * Passing an incorrect encoding scheme name will result in an exception.
     *
     * @param {string} webEncoding
     */
    setNativeDecoder(webEncoding) {
        this.decoder = new TextDecoder(webEncoding);
    }

    /**
     * Main method for changing decoder.
     *
     * Given a DICOM encoding scheme like ISO 2022 IR 100, generate the correct
     * string to use in JavaScript applications.
     *
     * Optionally, include whether to ignore or throw an exception if dicom to
     * web encoding is not found in our mapping
     *
     * @param {string} dicomEncoding
     * @param {boolean} ignoreErrors
     */
    setDecoder(dicomEncoding, ignoreErrors = false) {
        let coding = selectNativeEncoding(dicomEncoding, ignoreErrors);
        this.setNativeDecoder(coding);
    }

    /**
     * Unused since we typically default to utf-8. This method is provided for
     * convenience in case someone needs to encode a buffer in something else
     * before storing in a DICOM header.
     *
     * @param {string} webEncoding
     */
    setNativeEncoder(webEncoding) {
        this.decoder = new TextDecoder(webEncoding);
    }

    /**
     * Convenience method as would be found in TextEncoder and TextDecoder APIs.
     *
     * @param data
     * @returns {string}
     */
    decode(data) {
        return this.decoder.decode(data);
    }

    /**
     * Convenience method as would be found in TextEncoder and TextDecoder APIs.
     *
     * @param {string} data
     * @returns {Uint8Array}
     */
    encode(data) {
        return this.encoder.encode(data);
    }
}
