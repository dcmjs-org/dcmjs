/**
 * The error structure returned when a function is called with a illegal argument
 */
export default class IllegalArgumentsError extends Error {
    /**
     * Construct a new Error object
     * @param {string} message - an message to return instead of the the default error message
     */
    constructor(message) {
        super(message);
    }
}
