/**
 * A DICOM Metadata listener implements the basic listener for creating a dicom
 * metadata instance from a stream of notification events.
 *
 * There are additional listeners defined in @cornerstonejs/metadata as well as
 * other event sources in that package.
 *
 * **WARNING** This class is still under development, do not count on the API
 * not changing a bit over the next few dcmjs releases.
 */
export class DicomMetadataListener {
    current = null;
    fmi = null;
    dict = null;

    /**
     * Adds a new tag value
     */
    addTag(tag, tagInfo) {
        const dest = {
            vr: tagInfo?.vr,
            Value: null
        };
        if (this.current.dest) {
            this.current.dest[tag] = dest;
        }
        this.current = { parent: this.current, dest, type: tag };
    }

    /**
     * Starts a new object, using the provided value
     */
    startObject(dest = {}) {
        this.current = { parent: this.current, dest, type: "object" };
    }

    /**
     * Starts a new array, using the provided value
     */
    startArray(dest = []) {
        this.current = { parent: this.current, dest, type: "array" };
    }

    /**
     * Pops the current value being created off the stack.
     */
    pop() {
        const result = this.current.pop?.() ?? this.current.dest;
        this.current = this.current.parent;
        return result;
    }

    /**
     * Registers a new value for the current destination being created
     */
    value(v) {
        this.current.dest.Value ||= [];
        this.current.dest.Value.push(v);
    }

    /**
     * Reads the Value[0] instance of the given tag for pixel data parsing.
     */
    getValue(tag) {
        return this.current.parent[tag]?.Value?.[0];
    }
}
