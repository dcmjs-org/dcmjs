import { ReadBufferStream } from "../BufferStream.js";
import { UNDEFINED_LENGTH, VM_DELIMITER } from "../constants/dicom.js";
import { resolveCharsetDecoder } from "../charset/iso2022.js";
import { log } from "../log.js";
import { DicomMessage, singleVRs } from "../DicomMessage.js";
import { Tag } from "../Tag.js";
import { ValueRepresentation } from "../ValueRepresentation.js";

/**
 * Shared element-decode core extracted from src/lazy/LazyDicomReader.js.
 *
 * All functions operate on two read-only input shapes instead of the mutable
 * `ctx` used by the lazy reader:
 *
 *   window  = { arrayBuffer, baseOffset, syntax, littleEndian, implicit, decoder }
 *             A fully-resolved byte region. Callers construct a *meta window*
 *             (original buffer, EXPLICIT_LITTLE_ENDIAN, littleEndian=true,
 *             implicit=false, decoder=null) or a *body window* (post-inflate
 *             buffer, negotiated syntax/endianness/implicitness, active decoder).
 *             There is no `isMeta` parameter anywhere in this module: callers
 *             select the correct window.
 *
 *   policy  = { forceStoreRaw, noCopy, ignoreErrors }
 *
 * Every function body that reaches DicomMessage / Tag accesses them at call
 * time, never at module-evaluation time, to honour the circular-import
 * discipline of the wider codebase.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers (not exported)
// ──────────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────
// Exported functions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the ValueRepresentation instance for a parser element,
 * replicating DicomMessage._readTag's VR resolution rules
 * (src/DicomMessage.js, explicit + implicit branches).
 *
 * THIS IS THE SINGLE CANONICAL IMPLICIT-VR CONTRACT (AD-1). Every read
 * path — eager, lazy, fromPart10, fromPart10Stream — resolves implicit
 * VRs here, with eager parity: a DEFINED-length dictionary-miss element
 * resolves to UN (or OW/LO by tag rules) and is NEVER data-peek-promoted
 * to SQ, regardless of its value bytes; an UNDEFINED-length dictionary
 * miss resolves to SQ by the length rule. The parser's el.items (its
 * framing peek) is metadata only and must not influence VR resolution.
 *
 * `window.implicit` is already resolved by the caller: a meta window
 * always carries implicit=false; a body window carries the negotiated value.
 * The lazy source computed `ctx.implicit && !isMeta`; here the caller
 * selects the window instead.
 *
 * Uses DicomMessage.lookupTag, ValueRepresentation.parseUnknownVr /
 * createByTypeString, Tag — all accessed inside the function body.
 */
export function resolveVrInstance(el, window) {
    const implicit = window.implicit;

    if (!implicit) {
        const vrType = el.vr;
        if (vrType === "UN") {
            const tag = new Tag(el.tagValue);
            const elementData = DicomMessage.lookupTag(tag);
            if (elementData && elementData.vr) {
                // UN with a known dictionary VR: eager re-parses the value
                // as the dictionary VR via ParsedUnknownValue.
                let dictVr = elementData.vr;
                if (dictVr === "xs") {
                    dictVr = resolveXsVr(window);
                }
                return ValueRepresentation.parseUnknownVr(dictVr);
            }
        }
        return ValueRepresentation.createByTypeString(vrType);
    }

    // Implicit VR: dictionary lookup with _readTag's fallback rules.
    const tag = new Tag(el.tagValue);
    const elementData = DicomMessage.lookupTag(tag);
    let vrType;
    if (elementData) {
        vrType = elementData.vr;
        if (vrType === "xs") {
            vrType = resolveXsVr(window);
        }
    } else if (el.hadUndefinedLength) {
        // eager: length == UNDEFINED_LENGTH (the parser corrects element
        // .length for undefined-length elements, so use the flag)
        vrType = "SQ";
    } else if (tag.isPixelDataTag()) {
        vrType = "OW";
    } else if (tag.isPrivateCreator()) {
        vrType = "LO";
    } else {
        vrType = "UN";
    }
    return ValueRepresentation.createByTypeString(vrType);
}

/**
 * Resolves the dictionary meta-VR "xs" ("US or SS") by PixelRepresentation
 * (PS3.5): SS when (0028,0103) is 1, US otherwise — including when the
 * window carries no pixelRepresentation (parity with DicomMessage._readTag,
 * fixed in this arc for issue #368). Sources thread the parsed
 * (0028,0103) value onto their read window as `pixelRepresentation`;
 * (0028,0103) precedes every xs tag in tag order.
 */
function resolveXsVr(window) {
    return window.pixelRepresentation === 1 ? "SS" : "US";
}

/**
 * True when resolveVrInstance produced a ParsedUnknownValue (UN element with
 * a known dictionary VR): those are per-call instances, while every plain VR
 * resolves to the shared VRinstances singleton.
 */
export function isParsedUnknownVr(vrInstance) {
    return (
        vrInstance !== ValueRepresentation.createByTypeString(vrInstance.type)
    );
}

/**
 * Verbatim replication of DicomMessage._readTag's value-shaping block
 * (src/DicomMessage.js:380-402): string VM splitting, the SQ and OW/OB
 * passthroughs and the array-or-push fallback (which yields
 * `_rawValue: [undefined]` for non-raw-storing VRs like UN/OF/OD - a quirk
 * the lazy core must reproduce).
 *
 * Uses the canonical singleVRs exported from DicomMessage (includes LT).
 * Arg order is (vr, rawValue, value) — same as the source.
 */
export function shapeReadValues(vr, rawValue, value) {
    let values = [];
    let rawValues = [];
    if (!vr.isBinary() && singleVRs.indexOf(vr.type) == -1) {
        rawValues = rawValue;
        values = value;
        if (typeof value === "string") {
            const delimiterChar = String.fromCharCode(VM_DELIMITER);
            rawValues = vr.dropPadByte(rawValue.split(delimiterChar));
            values = vr.dropPadByte(value.split(delimiterChar));
        }
    } else if (vr.type == "SQ") {
        rawValues = rawValue;
        values = value;
    } else if (vr.type == "OW" || vr.type == "OB") {
        rawValues = rawValue;
        values = value;
    } else {
        Array.isArray(value) ? (values = value) : values.push(value);
        Array.isArray(rawValue)
            ? (rawValues = rawValue)
            : rawValues.push(rawValue);
    }
    return { values, rawValues };
}

/**
 * Replicates ValueRepresentation.read's raw-value retention rule
 * (src/ValueRepresentation.js:213-215) for values produced outside vr.read.
 *
 * First arg is policy (not ctx), so callers pass { forceStoreRaw }.
 */
export function retainRaw(policy, vr, producedValue) {
    return vr.storeRaw() || policy.forceStoreRaw ? producedValue : undefined;
}

/**
 * Constructs a ReadBufferStream over the element's data bytes within the
 * given window, mirroring the stream construction in materializeElement
 * (src/lazy/LazyDicomReader.js:565-575).
 *
 * start = window.baseOffset + el.dataOffset
 * stop  = start + el.length
 *
 * policy.noCopy controls whether getBuffer() returns a Uint8Array (true) or
 * an ArrayBuffer (false), exactly as the source does. When window.decoder is
 * non-null the stream's decoder is set before returning.
 * NOTE: callers using a meta window must pass policy.noCopy = false (the lazy
 * source always forced noCopy off for meta reads).
 */
export function buildElementStream(window, el, policy) {
    const start = window.baseOffset + el.dataOffset;
    const stream = new ReadBufferStream(
        window.arrayBuffer,
        window.littleEndian,
        {
            start,
            stop: start + effectiveElementLength(window, el, true),
            // eager's body stream carries noCopy (getBuffer then returns
            // Uint8Array instead of ArrayBuffer); its meta stream comes from
            // stream.more(), which drops it
            noCopy: policy.noCopy
        }
    );
    if (window.decoder) {
        stream.setDecoder(window.decoder);
    }
    return stream;
}

/**
 * Corrective guard: a defined length that overruns the underlying buffer is
 * a corrupt length (or a derailed walk). Historic (and test-pinned) leniency
 * reads truncated trailing elements, so the length is CLAMPED to the bytes
 * actually available — but no longer silently (the corruption is logged, and
 * phantom multi-GB allocations from garbage lengths are avoided). Parity
 * with the classic reader's overrun clamp in DicomMessage._readTag.
 */
function effectiveElementLength(window, el, warn) {
    const available =
        window.arrayBuffer.byteLength - (window.baseOffset + el.dataOffset);
    if (
        el.length === undefined ||
        el.length === UNDEFINED_LENGTH ||
        el.length <= available
    ) {
        return el.length;
    }
    if (warn) {
        log.warn(
            `decodeCore: element ${el.tag || ""} declares ${el.length} ` +
                `bytes but only ${Math.max(available, 0)} remain in the ` +
                `buffer; clamping to the remaining bytes`
        );
    }
    return Math.max(available, 0);
}

/**
 * Decodes the value phase of a defined-length element, mirroring the tail of
 * materializeElement (src/lazy/LazyDicomReader.js:557-598): the binary
 * multi-read loop (oversized binary values), or a single vr.read() followed
 * by shapeReadValues for everything else.
 *
 * Callers must already have built the stream via buildElementStream or have
 * established that the element is defined-length (not undefined-length, not
 * a sequence, not encapsulated pixel data). Use classifyElement to determine
 * the routing before calling.
 */
export function decodeElementValues(window, el, vrInstance, policy) {
    const vr = vrInstance;
    // Clamped for buffer-overrunning corrupt lengths (see
    // effectiveElementLength); buildElementStream applies (and logs) the
    // same clamp for the stream's stop offset.
    const length = effectiveElementLength(window, el, false);
    const stream = buildElementStream(window, el, policy);
    const readOptions = { forceStoreRaw: policy.forceStoreRaw };

    if (vr.isBinary() && length > vr.maxLength && !vr.noMultiple) {
        const values = [];
        const rawValues = [];
        const times = length / vr.maxLength;
        let i = 0;
        while (i++ < times) {
            const { rawValue, value } = vr.read(
                stream,
                vr.maxLength,
                window.syntax,
                readOptions
            );
            rawValues.push(rawValue);
            values.push(value);
        }
        return { values, rawValues };
    }
    const { rawValue, value } =
        vr.read(stream, length, window.syntax, readOptions) || {};
    return shapeReadValues(vr, rawValue, value);
}

/**
 * NARROW FALLBACK: eagerly re-reads a single element by running
 * DicomMessage._readTag over a window covering the element's full span
 * [startOffset, endOffset). Delegates rare shapes the structural paths do not
 * cover to the exact eager code, so results are byte-equivalent by
 * construction — including eager's error behavior for malformed framing.
 *
 * Mirrors materializeWithEagerReadTag (src/lazy/LazyDicomReader.js:450-476)
 * minus the lazy `entry` bookkeeping (_untrackedNested flagging) — that
 * stays with the lazy caller; callers that need it should flag the entry
 * after this call returns.
 *
 * Returns { values, rawValues } in the same shape as decodeElementValues.
 */
export function decodeWithEagerReadTag(window, el, policy) {
    const start = window.baseOffset + el.startOffset;
    const stop = window.baseOffset + el.endOffset;
    const stream = new ReadBufferStream(
        window.arrayBuffer,
        window.littleEndian,
        {
            start,
            stop,
            // eager's body stream carries noCopy; its meta stream comes from
            // stream.more(), which drops it
            noCopy: policy.noCopy
        }
    );
    if (window.decoder) {
        stream.setDecoder(window.decoder);
    }
    const readInfo = DicomMessage._readTag(stream, window.syntax, {
        untilTag: null,
        includeUntilTagValue: false,
        forceStoreRaw: policy.forceStoreRaw
    });
    return { values: readInfo.values, rawValues: readInfo.rawValues };
}

/**
 * Routing predicate: maps an element and its resolved VR instance to one of
 * four decode strategies, mirroring the routing logic in materializeElement
 * (src/lazy/LazyDicomReader.js:533-556).
 *
 * Returns one of:
 *   "sequence"    — real SQ singleton (VR identity check, excluding
 *                   ParsedUnknownValue); delegate to sequence materializer
 *   "encapsulated"— el.hadUndefinedLength + el.encapsulatedPixelData + not
 *                   ParsedUnknownValue; delegate to encapsulated pixel data
 *   "eagerWindow" — any other hadUndefinedLength; delegate to eager fallback
 *   "value"       — defined-length element; use decodeElementValues
 */
export function classifyElement(el, vrInstance) {
    // identity check: a ParsedUnknownValue with dictionary VR "SQ" is a
    // per-call instance, not the shared SQ singleton, and must keep eager's
    // ParsedUnknownValue.read path.
    if (vrInstance === ValueRepresentation.createByTypeString("SQ")) {
        return "sequence";
    }
    if (el.hadUndefinedLength) {
        if (el.encapsulatedPixelData && !isParsedUnknownVr(vrInstance)) {
            return "encapsulated";
        }
        // UN parsed as implicit SQ by the tokenizer, ParsedUnknownValue with
        // undefined length, delimiter-scanned values: delegate to eager.
        return "eagerWindow";
    }
    return "value";
}

/**
 * Resolves the dataset decoder from SpecificCharacterSet (00080005) with
 * the exact eager semantics of DicomMessage._read (src/DicomMessage.js:77-105):
 * encodingMapping lookup, warn-or-throw per policy.ignoreErrors for unsupported
 * or multiple charsets, and the entry Value rewritten to ["ISO_IR 192"] while
 * _rawValue keeps the original.
 *
 * Side-effect-free version of resolveCharacterSet in LazyDicomReader: instead
 * of assigning ctx.decoder the resolved TextDecoder is RETURNED in the result
 * object. The caller is responsible for setting it on the body window.
 *
 * Returns { decoder, vrInstance, originalValues, seedState } or null if csEl
 * is absent.
 *
 *   decoder        — the resolved TextDecoder, or null when the charset is
 *                    unsupported under ignoreErrors=true.
 *   vrInstance     — the resolved VR for the charset element.
 *   originalValues — the values as stored in the file, BEFORE the ISO_IR 192
 *                    rewrite (consumed by the charsetPassthroughSafe check).
 *   seedState      — { values: ["ISO_IR 192"], rawValues } — the seed for the
 *                    00080005 lazy entry (eager quirk: rewrites Value to UTF-8).
 */
export function resolveCharacterSet(window, csEl, policy) {
    if (!csEl) {
        return null;
    }
    const vrInstance = resolveVrInstance(csEl, window);
    // Read with the default (latin1) decoder, exactly like the eager loop
    // does before it reaches the setDecoder call.
    const { values, rawValues } = decodeElementValues(
        window,
        csEl,
        vrInstance,
        policy
    );

    // Shared charset resolution (single charsets, ISO 2022 code extensions,
    // error policy) — src/charset/iso2022.js. Same eager error semantics:
    // throws when ignoreErrors=false, warns and degrades to a null decoder
    // when ignoreErrors=true.
    const decoder = resolveCharsetDecoder(values, {
        ignoreErrors: policy.ignoreErrors
    });

    return {
        decoder,
        vrInstance,
        // the values as stored in the file, BEFORE the ISO_IR 192 rewrite
        // (consumed by the charsetPassthroughSafe computation)
        originalValues: values,
        seedState: {
            // change SpecificCharacterSet to UTF-8 (eager quirk, kept)
            values: ["ISO_IR 192"],
            rawValues
        }
    };
}
