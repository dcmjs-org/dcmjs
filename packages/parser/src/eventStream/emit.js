import { emitEntry } from "./fromDataSet.js";

/**
 * Shared emit helpers for byte-level event sources.
 *
 * These route a decoded element ({ values, rawValues }) to the correct
 * listener events. They lived in the tokenizer-backed fromPart10 module;
 * with the vendored tokenizer removed they are a standalone module the
 * streaming reader (and the thin fromPart10 wrapper) share.
 */

/**
 * Emits a decoded leaf element. Undefined-length UN parsed as an
 * implicit-VR sequence, so the decode yields item dicts — those are
 * emitted as sequence events (matching the eager dict shape); everything
 * else routes through emitValues.
 */
export function emitDecodedLeaf(
    listener,
    tag,
    vrInstance,
    el,
    values,
    rawValues
) {
    // Sequence-shaped decodes: (a) UN with undefined length parsed as an
    // implicit-VR sequence (PS3.5 §6.2.2, issue #363), and (b) defined-length
    // UN whose dictionary VR is SQ (ParsedUnknownValue re-parses the value as
    // a sequence — corpus shape "EVRLE SQ as UN"). Both decode to item dicts
    // in `values` and must be emitted as sequence events; emitting them
    // through the scalar value() path crashed on rawValues[index] (the
    // corpus bare-TypeError cluster).
    if (
        (vrInstance.type === "SQ" ||
            (vrInstance.type === "UN" && el.hadUndefinedLength)) &&
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
 */
export function emitValues(listener, tag, vrInstance, el, values, rawValues) {
    // Normalize the decoded shapes: some VR reads legitimately yield a bare
    // value or no rawValues array (classic stores these shapes untouched in
    // the dict; the event stream must not crash on them — corpus
    // bare-TypeError cluster).
    const list = Array.isArray(values)
        ? values
        : values === undefined || values === null
        ? []
        : [values];
    if (list.some(isBufferLike)) {
        listener.startElement(tag, { vr: vrInstance.type, length: el.length });
        listener.startBinary({ encapsulated: false });
        for (const buf of list) {
            listener.binaryFragment(buf);
        }
        listener.endBinary();
        listener.endElement();
        return;
    }

    listener.startElement(tag, { vr: vrInstance.type, length: el.length });
    let index = 0;
    for (const v of list) {
        listener.value(v, {
            index,
            rawValue: Array.isArray(rawValues) ? rawValues[index] : undefined
        });
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
