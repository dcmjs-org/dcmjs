/**
 * A filter for DicomMetadataListener that converts ArrayBuffer[] child values
 * into expanded listener.startArray() and value(fragment) calls.
 *
 * This is useful when you have compressed or fragmented pixel data delivered
 * as an array of ArrayBuffers and want to process each fragment individually
 * through the standard listener sequence pattern.
 *
 * @example
 * // Use as a filter in DicomMetadataListener constructor
 * const listener = new DicomMetadataListener(ArrayBufferExpanderFilter);
 * await reader.readFile({ listener });
 *
 * @example
 * // Combine with other filters
 * const listener = new DicomMetadataListener(
 *   ArrayBufferExpanderFilter,
 *   myCustomFilter
 * );
 */
export const ArrayBufferExpanderFilter = {
    /**
     * Filter method that intercepts value calls to expand ArrayBuffer[] into
     * individual fragments.
     *
     * When the value is an array where every element is an ArrayBuffer:
     * 1. Saves the current tag context
     * 2. Calls this.startArray() to create a new array context
     * 3. Calls this.value(fragment) for each ArrayBuffer in the array
     * 4. Calls this.pop() to get the resulting array
     * 5. Assigns that array to the tag's Value field
     *
     * This is necessary because when AsyncDicomReader delivers ArrayBuffer[]
     * directly to value(), it does not call startArray/pop around them, so we
     * must make those calls to properly represent the array structure.
     *
     * Otherwise, it passes the value through unchanged to the next filter.
     *
     * @param {Function} next - The next function in the filter chain
     * @param {*} v - The value to process
     */
    value(next, v) {
        // Check if the value is an array of ArrayBuffers
        if (
            Array.isArray(v) &&
            v.length > 0 &&
            v.every(
                item => item instanceof ArrayBuffer || ArrayBuffer.isView(item)
            )
        ) {
            // Expand the ArrayBuffer[] into the proper sequence
            // The reader hasn't called startArray for this, so we must

            // Save the current tag context
            const tagContext = this.current;

            // Call startArray to create a new array context
            this.startArray();

            // Add each fragment
            for (const fragment of v) {
                this.value(fragment);
            }

            // Pop to get the resulting array structure
            const arrayResult = this.pop();

            // Now we're back in the tag context - assign the array to Value
            // The arrayResult will have a Value property with the fragments
            tagContext.dest.Value = arrayResult.Value || arrayResult;
        } else {
            // Pass through non-ArrayBuffer[] values unchanged
            next(v);
        }
    }
};
