/**
 * EventStreamListener — the push-core of the dcmjs event-stream contract.
 *
 * This is the canonical, low-allocation listener interface that every reader,
 * writer, filter, validator, and anonymizer speaks (see CLAUDE_REFACTOR_PLAN.md,
 * slice A). It formalizes the implicit `next`-middleware model that previously
 * lived in DicomMetadataListener, with the richer, explicit vocabulary the
 * Naturalized DICOM Metadata Behavior Specification calls for (§15.1).
 *
 * The vocabulary:
 *
 *   Lifecycle:  startDataSet / endDataSet
 *               startFileMetaInformation / endFileMetaInformation
 *   Structural: startElement / endElement
 *               startSequence / endSequence
 *               startItem / endItem
 *               value(v, { index, rawValue? })
 *   Binary:     bulkDataReference
 *               startBinary / binaryFragment / endBinary
 *
 * The `value` event's options bag is optional and extensible; `rawValue` carries
 * the source string (when available) for precision-preserving retention
 * (§16/§27). Consumers that don't need it ignore it.
 *
 * Structural and value callbacks are synchronous (allocation-free hot path,
 * §15.4 / §24.1). Backpressure is applied out of band via setDrain/awaitDrain,
 * which generators await only at defined checkpoints (top-level element
 * boundaries and binary-fragment emission).
 *
 * Filters are first-class: each filter is an object that may implement any
 * vocabulary method as `method(next, ...args)`; calling `next(...)` invokes the
 * rest of the chain, ending in the listener's `_base<Method>` implementation.
 */

export const EVENT_STREAM_VOCABULARY = [
    "startDataSet",
    "endDataSet",
    "startFileMetaInformation",
    "endFileMetaInformation",
    "startElement",
    "endElement",
    "startSequence",
    "endSequence",
    "startItem",
    "endItem",
    "value",
    "bulkDataReference",
    "startBinary",
    "binaryFragment",
    "endBinary"
];

/** Contract version — generators and listeners can declare conformance. */
export const CONTRACT_VERSION = "1.0.0-A";

/**
 * Merge raw encapsulated-pixel-data fragments into one buffer per Basic
 * Offset Table window (issue #204 — eager-reader shape parity for
 * BOT-aware listeners). The event stream itself stays raw (one
 * binaryFragment per on-wire fragment); listeners that rebuild a dataset
 * call this at endBinary time when startBinary carried a non-empty
 * `basicOffsetTable`.
 *
 * Fragment offsets are reconstructed from the fragment lengths: fragment
 * i's item header starts at Σ_{j<i} (8 + length_j), matching the BOT's
 * item-header-relative offset convention. Grouping and merge semantics
 * mirror BinaryRepresentation.readBytes: a single-fragment window stays
 * that fragment's buffer; a multi-fragment window merges into one
 * ArrayBuffer.
 *
 * @param {Array<ArrayBuffer|TypedArray>} fragments raw fragment buffers
 * @param {number[]} basicOffsetTable BOT offsets (item-header relative)
 * @returns {Array<ArrayBuffer|TypedArray>} one entry per BOT window
 */
export function mergeFragmentsPerBotWindow(fragments, basicOffsetTable) {
    if (!basicOffsetTable || basicOffsetTable.length === 0) {
        return fragments;
    }
    const toBytes = f =>
        f instanceof ArrayBuffer
            ? new Uint8Array(f)
            : new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
    let offset = 0;
    const placed = fragments.map(fragment => {
        const length = fragment.byteLength;
        const entry = { fragment, offset, length };
        offset += 8 + length;
        return entry;
    });
    const frames = [];
    for (let i = 0; i < basicOffsetTable.length; i++) {
        const start = basicOffsetTable[i];
        const stop =
            i + 1 < basicOffsetTable.length
                ? basicOffsetTable[i + 1]
                : Number.POSITIVE_INFINITY;
        const windowFragments = placed.filter(
            f => f.offset >= start && f.offset < stop
        );
        if (windowFragments.length === 1) {
            frames.push(windowFragments[0].fragment);
            continue;
        }
        const frameSize = windowFragments.reduce((n, f) => n + f.length, 0);
        const merged = new Uint8Array(frameSize);
        let position = 0;
        for (const f of windowFragments) {
            merged.set(toBytes(f.fragment), position);
            position += f.length;
        }
        frames.push(merged.buffer);
    }
    return frames;
}

export class EventStreamListener {
    /**
     * @param {...Object} filters - Filter objects. Each may implement any
     *        vocabulary method as `method(next, ...args)`.
     */
    constructor(...filters) {
        this.filters = filters.filter(Boolean);
        this._drain = null;
        this._createMethodChains();
    }

    /**
     * Builds, for every vocabulary method, a chain that threads each filter's
     * implementation in front of the base implementation via `next`.
     * @private
     */
    _createMethodChains() {
        for (const methodName of EVENT_STREAM_VOCABULARY) {
            const baseName = `_base${methodName[0].toUpperCase()}${methodName.slice(
                1
            )}`;
            let chain = this[baseName].bind(this);

            for (let i = this.filters.length - 1; i >= 0; i--) {
                const filter = this.filters[i];
                const filterFn = filter && filter[methodName];
                if (typeof filterFn === "function") {
                    const next = chain;
                    chain = (...args) => filterFn.call(this, next, ...args);
                }
            }

            this[methodName] = chain;
        }
    }

    // --- Backpressure -------------------------------------------------------

    /**
     * Install a backpressure gate. The function should return a Promise that
     * resolves when it is safe to emit more data. Pass null to clear.
     * @param {(() => Promise<void>) | null} fn
     */
    setDrain(fn) {
        this._drain = typeof fn === "function" ? fn : null;
    }

    /**
     * Await the backpressure gate (resolves immediately when none is set).
     * Generators call this only at defined checkpoints.
     * @returns {Promise<void>}
     */
    awaitDrain() {
        return this._drain ? this._drain() : Promise.resolve();
    }

    // --- Base (no-op) vocabulary implementations ----------------------------
    // Consumers override these (or subclass) to do real work. They are no-ops
    // here so the base listener is a valid, inert sink.

    _baseStartDataSet() {}
    _baseEndDataSet() {}
    _baseStartFileMetaInformation() {}
    _baseEndFileMetaInformation() {}
    _baseStartElement() {}
    _baseEndElement() {}
    _baseStartSequence() {}
    _baseEndSequence() {}
    _baseStartItem() {}
    _baseEndItem() {}
    _baseValue() {}
    _baseBulkDataReference() {}
    _baseStartBinary() {}
    _baseBinaryFragment() {}
    _baseEndBinary() {}
}
