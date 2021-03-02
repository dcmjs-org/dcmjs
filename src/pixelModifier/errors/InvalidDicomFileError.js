/**
 * The error structure returned when a dicom file has invalid format
 */
export default class InvalidDicomFileError extends Error {
    /**
     * Construct a new Error object
     * @param {string} message - an message to return instead of the the default error message
     */
    constructor(message) {
        super(message);
    }
}
