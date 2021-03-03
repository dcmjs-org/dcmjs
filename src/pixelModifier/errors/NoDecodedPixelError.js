/**
 * The error structure returned when a dicom file has no decoded pixel data
 */
export default class NoDecodedPixelError extends Error {
    /**
     * Construct a new Error object
     * @param {string} message - an message to return instead of the the default error message
     */
    constructor(message) {
        super(message);
    }
}
