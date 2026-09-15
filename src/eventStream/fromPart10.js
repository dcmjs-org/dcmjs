import {
    resolveVrInstance,
    decodeElementValues,
    resolveCharacterSet,
    decodeWithEagerReadTag,
    seedReadContext
} from "../core/decodeCore.js";
import { emitEntry } from "./fromDataSet.js";

/**
 * fromPart10 — a genuine raw-bytes Part 10 -> event-stream generator.
 *
 * Walks @dcmjs/parser's offsets tree in source order and emits the event-stream
 * contract, decoding each element with decodeCore primitives (resolveVrInstance,
 * decodeElementValues, resolveCharacterSet). Encapsulated pixel data is emitted
 * as RAW fragments (§33); frame grouping is naturalization (slice D).
 * Defined-length binary is one fragment.
 *
 * Parsing is delegated to decodeCore.seedReadContext which runs @dcmjs/parser
 * with the pako inflater (transparent for non-deflate syntax) and returns
 * ready-to-use metaWindow (original buffer) and bodyWindow (inflated body).
 * Undefined-length non-SQ elements (classifyElement "eagerWindow") are decoded
 * per-element via decodeCore.decodeWithEagerReadTag.  Tokenizer-rejected files
 * propagate the error directly (empirical corpus check confirmed no file needs
 * eager fallback — slice J stage 4c).
 *
 * Documented behavior deltas vs the old fromPart10 (both are DELIBERATE
 * convergence on eager DicomMessage.readFile semantics):
 *   1. shapeReadValues convergence: multi-value shaping now follows the eager
 *      singleVRs branch structure (core import) instead of allowMultiple()+
 *      alignRaw. Output is byte-equivalent for all standard VR types.
 *   2. Charset error policy: resolveCharacterSet (top-level and per-item) now
 *      throws on unsupported/multiple charsets when ignoreErrors=false, where
 *      the old resolveDecoder silently returned null. ignoreErrors=true still
 *      degrades to null decoder (core handles it internally).
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {import("./EventStreamListener").EventStreamListener} listener
 * @param {Object} [options] DicomMessage.readFile-style options
 */
export async function fromPart10(buffer, listener, options = {}) {
    const byteArray = toUint8Array(buffer);

    // seedReadContext parses with @dcmjs/parser (inflater enabled for deflate),
    // extracts the transfer syntax, and returns ready-to-use windows where
    // metaWindow indexes the original (possibly compressed) buffer and
    // bodyWindow indexes the (possibly inflated) body buffer.  This replaces
    // the direct parseDicom call + manual window construction and eliminates
    // the deflate early-return delegation path (slice J stage 4b).
    let dataSet, syntax, metaWindow, bodyWindow;
    try {
        ({ dataSet, syntax, metaWindow, bodyWindow } = seedReadContext(
            byteArray,
            options
        ));
    } catch (e) {
        // Empirical check (slice J stage 4c) confirmed: every corpus file either
        // passes seedReadContext or is also rejected by DicomMessage.readFile —
        // no file requires a whole-file fallback here.  Propagate directly.
        throw e;
    }

    const policy = {
        forceStoreRaw: !!options.forceStoreRaw,
        noCopy: false,
        ignoreErrors: !!options.ignoreErrors
    };

    listener.startDataSet({ transferSyntaxUID: syntax });

    const elements = dataSet.elements;
    const keys = Object.keys(elements).filter(k => k !== "xfffee00d");
    const metaKeys = keys.filter(k => isMetaKey(k));
    const bodyKeys = keys.filter(k => !isMetaKey(k));

    if (metaKeys.length) {
        listener.startFileMetaInformation();
        for (const key of metaKeys) {
            emitElement(
                listener,
                metaWindow,
                bodyWindow,
                policy,
                elements[key],
                true,
                null
            );
        }
        listener.endFileMetaInformation();
    }

    // Resolve the dataset decoder from SpecificCharacterSet (00080005).
    // resolveCharacterSet uses eager semantics: throws for unsupported
    // charsets when ignoreErrors=false (DELIBERATE convergence on eager),
    // degrades to null decoder when ignoreErrors=true.
    // The ISO_IR 192 seedState in the result is intentionally discarded:
    // the event stream emits SpecificCharacterSet as-in-file (corpus gate
    // exempts that tag from equivalence checking).
    const csResult = resolveCharacterSet(
        bodyWindow,
        elements.x00080005,
        policy
    );
    const decoder = csResult?.decoder ?? null;

    // Thread the parsed (0028,0103) PixelRepresentation onto the body
    // window so resolveVrInstance can resolve the "xs" (US-or-SS) meta-VR
    // per PS3.5 (issue #368). seedReadContext builds a fresh window per
    // call, so the in-place assignment is private to this parse; every
    // `{ ...bodyWindow }` copy below inherits the property.
    const prEl = elements.x00280103;
    if (prEl) {
        try {
            const prValues = decodeElementValues(
                bodyWindow,
                prEl,
                resolveVrInstance(prEl, bodyWindow),
                policy
            ).values;
            if (prValues && prValues.length) {
                bodyWindow.pixelRepresentation = prValues[0];
            }
        } catch {
            // Undecodable PixelRepresentation: keep the US default.
        }
    }

    for (const key of bodyKeys) {
        emitElement(
            listener,
            metaWindow,
            bodyWindow,
            policy,
            elements[key],
            false,
            decoder
        );
        await listener.awaitDrain();
    }

    listener.endDataSet();
}

/**
 * Emit a single element (or subtree) into the listener.
 *
 * `decoder` is the current-scope TextDecoder (null if no charset in effect).
 * For body elements it is merged into a copy of bodyWindow before passing to
 * decodeElementValues so the body window itself stays immutable — enabling
 * per-item decoder scoping in sequences without shared-state mutation.
 */
function emitElement(
    listener,
    metaWindow,
    bodyWindow,
    policy,
    el,
    isMeta,
    decoder
) {
    const tag = cleanTag(el);
    // Select the correct window for this element's scope and attach the
    // current decoder. metaWindow.decoder is always null (meta is always
    // decoded with the default latin1 decoder).
    const window = isMeta
        ? metaWindow
        : decoder
        ? { ...bodyWindow, decoder }
        : bodyWindow;
    // resolveVrInstance is the single canonical implicit-VR contract (AD-1):
    // defined-length dictionary-miss elements resolve to UN — never data-peek
    // promoted to SQ (eager parity). The parser may still populate el.items
    // via its framing peek; that metadata is deliberately ignored here.
    const vrInstance = resolveVrInstance(el, window);

    // Plain sequence (defined or undefined length).
    if (vrInstance.type === "SQ" && el.items) {
        listener.startSequence(tag, { vr: vrInstance.type, length: el.length });
        for (const item of el.items) {
            listener.startItem({ length: item.length });
            const itemElements = (item.dataSet && item.dataSet.elements) || {};
            // Per-item charset resolution: resolveCharacterSet throws for
            // unsupported charsets when ignoreErrors=false (convergence on
            // eager); degrades to null decoder (outer decoder used) when
            // ignoreErrors=true (handled internally by the core).
            const itemDecoder =
                resolveCharacterSet(bodyWindow, itemElements.x00080005, policy)
                    ?.decoder ?? decoder;
            for (const key of Object.keys(itemElements)) {
                if (key === "xfffee00d") continue;
                emitElement(
                    listener,
                    metaWindow,
                    bodyWindow,
                    policy,
                    itemElements[key],
                    isMeta,
                    itemDecoder
                );
            }
            listener.endItem();
        }
        listener.endSequence();
        return;
    }

    // Encapsulated pixel data -> raw fragments. The parser's Basic Offset
    // Table (when non-empty) rides on startBinary so BOT-aware listeners
    // can merge fragments per frame window (issue #204); the fragment
    // events themselves stay raw.
    if (el.encapsulatedPixelData && el.fragments) {
        listener.startElement(tag, { vr: vrInstance.type, length: el.length });
        const startBinaryInfo = { encapsulated: true };
        if (el.basicOffsetTable && el.basicOffsetTable.length) {
            startBinaryInfo.basicOffsetTable = Array.from(el.basicOffsetTable);
        }
        listener.startBinary(startBinaryInfo);
        for (const f of el.fragments) {
            listener.binaryFragment(fragmentBuffer(bodyWindow, f));
        }
        listener.endBinary();
        listener.endElement();
        return;
    }

    // Undefined-length non-SQ elements (classifyElement "eagerWindow"): re-read
    // the element span via the eager reader, exactly as the lazy core does via
    // materializeWithEagerReadTag.  This eliminates the whole-file delegation
    // that previously occurred here (slice J stage 4a).
    if (el.hadUndefinedLength) {
        const { values, rawValues } = decodeWithEagerReadTag(
            window,
            el,
            policy
        );
        emitDecodedLeaf(listener, tag, vrInstance, el, values, rawValues);
        return;
    }

    // Decode the value(s) with the core primitives, then route by the DECODED
    // type: byte-blob VRs (OB/OW/OF/OD/UN) produce ArrayBuffers and go to the
    // binary sub-stream; everything else (incl. numeric "binary" VRs like
    // SL/US which decode to numbers) goes to value().
    const { values, rawValues } = decodeElementValues(
        window,
        el,
        vrInstance,
        policy
    );
    emitValues(listener, tag, vrInstance, el, values, rawValues);
}

/**
 * Emit an eager-decoded undefined-length leaf. PS3.5 §6.2.2 (issue #363):
 * the eager reader parses a UN element with undefined length as an
 * implicit-VR sequence, so the decode yields item dicts — those are
 * emitted as sequence events (matching the eager dict shape); everything
 * else routes through emitValues. Exported for fromPart10Stream's
 * eager-window leaf path so both sources agree.
 */
export function emitDecodedLeaf(
    listener,
    tag,
    vrInstance,
    el,
    values,
    rawValues
) {
    if (
        vrInstance.type === "UN" &&
        el.hadUndefinedLength &&
        Array.isArray(values) &&
        values.every(isItemDictLike)
    ) {
        listener.startSequence(tag, { vr: "SQ", length: el.length });
        for (const itemDict of values) {
            listener.startItem({});
            for (const childTag of Object.keys(itemDict)) {
                emitEntry(listener, childTag, itemDict[childTag]);
            }
            listener.endItem();
        }
        listener.endSequence();
        return;
    }
    emitValues(listener, tag, vrInstance, el, values, rawValues);
}

/**
 * Route decoded {values, rawValues} to binary or scalar listener events.
 * Exported for reuse by fromPart10Stream's K3 incremental body loop.
 */
export function emitValues(listener, tag, vrInstance, el, values, rawValues) {
    if (values.some(isBufferLike)) {
        listener.startElement(tag, { vr: vrInstance.type, length: el.length });
        listener.startBinary({ encapsulated: false });
        for (const buf of values) {
            listener.binaryFragment(buf);
        }
        listener.endBinary();
        listener.endElement();
        return;
    }

    listener.startElement(tag, { vr: vrInstance.type, length: el.length });
    let index = 0;
    for (const v of values) {
        listener.value(v, { index, rawValue: rawValues[index] });
        index++;
    }
    listener.endElement();
}

function isItemDictLike(v) {
    return (
        v &&
        typeof v === "object" &&
        !(v instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(v) &&
        Object.keys(v).every(k => /^[0-9A-Fx]{8,9}$/i.test(k))
    );
}

function isBufferLike(v) {
    return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
}

// --- misc -------------------------------------------------------------------

function fragmentBuffer(window, f) {
    const start = window.baseOffset + f.position;
    return window.arrayBuffer.slice(start, start + f.length);
}

function cleanTag(el) {
    // parser key 'xggggeeee' (lowercase) -> dcmjs clean 'GGGGEEEE' (uppercase)
    return el.tag.slice(1).toUpperCase();
}

function isMetaKey(key) {
    // key is 'xggggeeee'; group is chars 1..5
    return key.slice(1, 5) === "0002";
}

function toUint8Array(buffer) {
    if (buffer instanceof Uint8Array) {
        return buffer;
    }
    return new Uint8Array(buffer);
}
