import { TAG_NAME_MAP, DEFAULT_INFORMATION_TAGS } from "../constants/dicom.js";

/**
 * Creates an information filter that tracks top-level DICOM attributes.
 *
 * @param {Set<string>} tags - Optional set of tag hex strings to track.
 *        If not provided, uses DEFAULT_INFORMATION_TAGS.
 * @returns {Object} A filter object that adds listener.information attribute
 */
export function createInformationFilter(tags = DEFAULT_INFORMATION_TAGS) {
    const filter = {
        information: null,
        /**
         * Initializes the filter, synchronizing the information object with the parent listener
         */
        _init(options) {
            filter.information = options?.information || {};
            this.information = filter.information;
        },
        /**
         * Intercepts addTag calls to track top-level attributes in listener.information
         */
        addTag(next, tag, tagInfo) {
            // Check if this is a top-level tag (level 0) and is in our tracked set
            if (this.current?.level === 0 && tags.has(tag)) {
                // Store a reference to track this tag for value updates
                const normalizedName = TAG_NAME_MAP[tag] || tag;
                this.information[normalizedName] = null;

                // Mark this tag for tracking
                const result = next(tag, tagInfo);
                this.current._trackInformation = normalizedName;
                return result;
            }

            return next(tag, tagInfo);
        },

        /**
         * Intercepts value calls to populate information values
         */
        value(next, v) {
            // If current context is tracking information, store the first value
            if (this.current?._trackInformation) {
                const name = this.current._trackInformation;
                this.information[name] = v;
                this.current._trackInformation = null;
            }

            return next(v);
        }
    };

    return filter;
}

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
    information = null;

    /**
     * Creates a new DicomMetadataListener instance.
     *
     * @param {Object} options - Configuration options
     * @param {Object} options.informationFilter - Optional information filter to use.
     *        If not provided, creates one automatically.
     * @param {Set<string>} options.informationTags - Optional set of tag hex strings
     *        to track in listener.information. If not provided, uses default tags.
     * @param {...Object} filters - Optional filter objects that can intercept
     *        method calls. Each filter can have methods like addTag, startObject,
     *        pop, or value. Each filter method receives a 'next'
     *        function as the first argument, followed by the same arguments as
     *        the original method.
     *
     * @example
     * const listener = new DicomMetadataListener();
     *
     * @example
     * const listener = new DicomMetadataListener(
     *   { informationTags: new Set(['0020000D', '0020000E']) }
     * );
     *
     * @example
     * const listener = new DicomMetadataListener(
     *   {},
     *   {
     *     addTag(next, tag, tagInfo) {
     *       console.log('Adding tag:', tag);
     *       return next(tag, tagInfo);
     *     }
     *   }
     * );
     */
    constructor(options = {}, ...filters) {
        // Handle legacy constructor format where first arg might be a filter
        if (
            typeof options.addTag === "function" ||
            typeof options.startObject === "function" ||
            typeof options.pop === "function" ||
            typeof options.value === "function"
        ) {
            // Legacy format: all arguments are filters
            filters = [options, ...filters];
            options = {};
        }

        // Information filter should always be first so it can track tags
        // Use the provided informationFilter or create a new one
        const informationFilter =
            options.informationFilter ||
            createInformationFilter(options.informationTags);

        this.filters = [informationFilter, ...filters];

        this._createMethodChains();

        // Initialize filters to synchronize state
        this.init(options);
    }

    /**
     * Initializes state, allowing it to be re-used.
     * @param {Object} options - Optional options to pass to the filters to re-initialize them
     * @param {Object} options.information - Optional information to pass to the filters
     * @returns {void}
     */
    init(options = undefined) {
        this.current = null;
        this.fmi = null;
        this.dict = null;
        this.information = null;

        for (const filter of this.filters) {
            filter._init?.call(this, options);
        }
    }

    /**
     * Creates method chains for each method that can be filtered.
     * @private
     */
    _createMethodChains() {
        const methods = ["addTag", "startObject", "pop", "value"];

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
            level: level,
            length: tagInfo?.length
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
        if (this.current) {
            this.value(dest);
        }
        this.current = {
            parent: this.current,
            dest,
            type: "object",
            level: level
        };
    }

    /**
     * Base implementation: Pops the current value being created off the stack.
     * @private
     */
    _basePop() {
        const result = this.current.pop?.() ?? this.current.dest;
        if (result.InlineBinary) {
            console.log(
                "********* InlineBinary already set",
                result,
                this.current
            );
        }
        if (result.Value === null) {
            result.Value = [];
        } else if (
            result.Value?.length === 1 &&
            (result.Value[0] === null || result.Value[0] === undefined)
        ) {
            result.Value = [];
        }
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
}
