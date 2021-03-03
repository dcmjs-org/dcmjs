/**
 * The error structure returned when a dicom file has no encoded pixel data
 */
export default class NoEncodedPixelError extends Error {
    /**
     * Construct a new Error object
     * @param {string} message - an message to return instead of the the default error message
     */
    constructor(message) {
        super(message);
    }
}
