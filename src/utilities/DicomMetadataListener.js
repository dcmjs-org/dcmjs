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
    filters = [];

    /**
     * Creates a new DicomMetadataListener instance.
     *
     * @param {...Object} filters - Optional filter objects that can intercept
     *        method calls. Each filter can have methods like addTag, startObject,
     *        startArray, pop, value, or getValue. Each filter method receives
     *        a 'next' function as the first argument, followed by the same
     *        arguments as the original method.
     *
     * @example
     * const listener = new DicomMetadataListener(
     *   {
     *     addTag(next, tag, tagInfo) {
     *       console.log('Adding tag:', tag);
     *       return next(tag, tagInfo);
     *     }
     *   },
     *   {
     *     startObject(next, dest) {
     *       console.log('Starting object');
     *       return next(dest);
     *     }
     *   }
     * );
     */
    constructor(...filters) {
        this.filters = filters;
        this._createMethodChains();
    }

    /**
     * Creates method chains for each method that can be filtered.
     * @private
     */
    _createMethodChains() {
        const methods = [
            "addTag",
            "startObject",
            "startArray",
            "pop",
            "value",
            "getValue"
        ];

        for (const methodName of methods) {
            const baseMethod =
                this[
                    `_base${
                        methodName.charAt(0).toUpperCase() + methodName.slice(1)
                    }`
                ].bind(this);

            // Build the chain by wrapping each filter
            // Start with the base implementation
            let chain = baseMethod;

            // Apply filters in reverse order so they execute in forward order
            for (let i = this.filters.length - 1; i >= 0; i--) {
                const filter = this.filters[i];
                if (filter && typeof filter[methodName] === "function") {
                    const filterFn = filter[methodName];
                    const next = chain;
                    chain = (...args) => filterFn.call(this, next, ...args);
                }
            }

            // Replace the method with the chained version
            this[methodName] = chain;
        }
    }

    /**
     * Base implementation: Adds a new tag value
     * @private
     */
    _baseAddTag(tag, tagInfo) {
        const dest = {
            vr: tagInfo?.vr,
            Value: null
        };
        if (this.current && this.current.dest) {
            this.current.dest[tag] = dest;
        }
        // Tags are at the same level as their parent (they're properties, not nested structures)
        const level = this.current ? this.current.level ?? 0 : 0;
        this.current = {
            parent: this.current,
            dest,
            type: tag,
            tag: tag,
            vr: tagInfo?.vr,
            level: level
        };
    }

    /**
     * Base implementation: Starts a new object, using the provided value
     * @private
     */
    _baseStartObject(dest = {}) {
        // Objects/sequences are nested structures, so they increment the level
        // Root object is at level 0, nested objects are one level deeper
        const level = this.current ? (this.current.level ?? 0) + 1 : 0;
        this.current = {
            parent: this.current,
            dest,
            type: "object",
            level: level
        };
    }

    /**
     * Base implementation: Starts a new array, using the provided value
     * @private
     */
    _baseStartArray(dest = []) {
        // Arrays/sequences are nested structures, so they increment the level
        const level = this.current ? (this.current.level ?? 0) + 1 : 0;
        this.current = {
            parent: this.current,
            dest,
            type: "array",
            level: level
        };
    }

    /**
     * Base implementation: Pops the current value being created off the stack.
     * @private
     */
    _basePop() {
        const result = this.current.pop?.() ?? this.current.dest;
        this.current = this.current.parent;
        return result;
    }

    /**
     * Base implementation: Registers a new value for the current destination being created
     * @private
     */
    _baseValue(v) {
        this.current.dest.Value ||= [];
        this.current.dest.Value.push(v);
    }

    /**
     * Base implementation: Reads the Value[0] instance of the given tag for pixel data parsing.
     * @private
     */
    _baseGetValue(tag) {
        return this.current.parent[tag]?.Value?.[0];
    }

    /**
     * Gets the Transfer Syntax UID from the File Meta Information (FMI)
     * @returns {string|undefined} - Transfer syntax UID or undefined if not available
     */
    getTransferSyntaxUID() {
        if (!this.fmi) {
            return undefined;
        }
        const transferSyntaxTag = "00020010"; // TransferSyntaxUID tag
        if (
            this.fmi[transferSyntaxTag]?.Value &&
            Array.isArray(this.fmi[transferSyntaxTag].Value) &&
            this.fmi[transferSyntaxTag].Value.length > 0
        ) {
            return this.fmi[transferSyntaxTag].Value[0];
        }
        return undefined;
    }

    /**
     * Gets a value from the root dict by tag.
     * This method can be overridden by filters if needed.
     * @param {string} tag - The DICOM tag hex string (e.g., '0020000D')
     * @returns {*|undefined} - The first value in the tag's Value array, or undefined if not present
     */
    getRootValue(tag) {
        if (
            this.dict &&
            this.dict[tag]?.Value &&
            Array.isArray(this.dict[tag].Value) &&
            this.dict[tag].Value.length > 0
        ) {
            return this.dict[tag].Value[0];
        }
        return undefined;
    }

    /**
     * Gets the Study Instance UID from the top-level dict
     * @returns {string|undefined} - Study Instance UID or undefined if not available
     */
    getStudyInstanceUID() {
        return this.getRootValue("0020000D"); // StudyInstanceUID tag
    }

    /**
     * Gets the Series Instance UID from the top-level dict
     * @returns {string|undefined} - Series Instance UID or undefined if not available
     */
    getSeriesInstanceUID() {
        return this.getRootValue("0020000E"); // SeriesInstanceUID tag
    }

    /**
     * Gets the SOP Instance UID from the top-level dict
     * @returns {string|undefined} - SOP Instance UID or undefined if not available
     */
    getSOPInstanceUID() {
        return this.getRootValue("00080018"); // SOPInstanceUID tag
    }
}
