/**
 * fromDataSet — the reference event-stream generator for slice A.
 *
 * Walks a parsed dcmjs dataset (a `{ meta, dict }` shape — e.g. the DicomDict
 * returned by `DicomMessage.readFile`, produced by the lazy core over
 * `@dcmjs/parser`) and pushes the event-stream contract to a listener. It
 * reuses the lazy core's already-decoded values rather than re-decoding raw
 * offsets, which keeps slice A decoupled from the Part 10 byte parser (that
 * production "bytes -> events" generator is slice B). This generator exercises
 * the spec §32 "tag / naturalized source -> event stream" path and proves the
 * vocabulary can carry a real dataset losslessly.
 *
 * Async by design: structural/value callbacks are synchronous, but the
 * generator awaits `listener.awaitDrain()` at the defined backpressure
 * checkpoints — top-level element boundaries and between binary fragments.
 *
 * @param {{ meta?: Object, dict?: Object }} dataset
 * @param {import("./EventStreamListener").EventStreamListener} listener
 */
import { base64ToArrayBuffer } from "./fromDicomWebJson.js";

export async function fromDataSet(dataset, listener) {
    const meta = dataset.meta || null;
    const dict = dataset.dict || dataset;

    listener.startDataSet({
        transferSyntaxUID: transferSyntaxOf(meta)
    });

    if (meta && Object.keys(meta).length) {
        listener.startFileMetaInformation();
        for (const tag of Object.keys(meta)) {
            emitEntry(listener, tag, meta[tag]);
        }
        listener.endFileMetaInformation();
    }

    for (const tag of Object.keys(dict)) {
        emitEntry(listener, tag, dict[tag]);
        // Top-level element boundary: a defined backpressure checkpoint.
        await listener.awaitDrain();
    }

    listener.endDataSet();
}

function transferSyntaxOf(meta) {
    const ts = meta && meta["00020010"];
    return ts && ts.Value ? ts.Value[0] : undefined;
}

/** Emit one tag entry (element, sequence, or binary) and its children.
 *  Exported for fromPart10's §6.2.2 UN-sequence emission (issue #363). */
export function emitEntry(listener, tag, entry) {
    if (!entry) {
        return;
    }
    const values = entry.Value || [];

    if (entry.vr === "SQ") {
        listener.startSequence(tag, { vr: entry.vr, length: entry.length });
        for (const item of values) {
            listener.startItem({ length: item && item._length });
            for (const childTag of Object.keys(item)) {
                emitEntry(listener, childTag, item[childTag]);
            }
            listener.endItem();
        }
        listener.endSequence();
        return;
    }

    // {InlineBinary} wrappers — the naturalized binary form produced by both
    // NaturalizedListener and DicomMetaDictionary.naturalizeDataset (§22).
    // Unwrap to binary events exactly as fromDicomWebJson does; without this
    // the wrapper object reaches BinaryRepresentation.writeBytes and throws
    // (the UN naturalize→write round-trip crash). The wrapper may sit on the
    // entry itself (no Value array) or inside Value; its content may be an
    // ArrayBuffer, a typed-array view, a base64 string, or an array of
    // fragments in any of those forms.
    if (entry.InlineBinary !== undefined || values.some(isInlineBinary)) {
        const wrappers = entry.InlineBinary !== undefined ? [entry] : values;
        listener.startElement(tag, { vr: entry.vr, length: entry.length });
        listener.startBinary({ encapsulated: !!entry.encapsulatedPixelData });
        for (const w of wrappers) {
            const inline = isInlineBinary(w) ? w.InlineBinary : w;
            for (const fragment of Array.isArray(inline) ? inline : [inline]) {
                listener.binaryFragment(toBinaryFragment(fragment));
            }
        }
        listener.endBinary();
        listener.endElement();
        return;
    }

    if (isBinary(values)) {
        listener.startElement(tag, { vr: entry.vr, length: entry.length });
        listener.startBinary({ encapsulated: !!entry.encapsulatedPixelData });
        for (const fragment of values) {
            listener.binaryFragment(fragment);
        }
        listener.endBinary();
        listener.endElement();
        return;
    }

    listener.startElement(tag, { vr: entry.vr, length: entry.length });
    // _rawValue (when present on lazy/eager dict entries) carries the source
    // string for precision-preserving retention (§16/§27).
    const rawValues = entry._rawValue;
    let index = 0;
    for (const v of values) {
        if (isBulkDataReference(v)) {
            listener.bulkDataReference({ uri: v.BulkDataURI });
        } else {
            listener.value(v, {
                index,
                rawValue: Array.isArray(rawValues)
                    ? rawValues[index]
                    : undefined
            });
        }
        index++;
    }
    listener.endElement();
}

function isBinary(values) {
    return values.some(v => v instanceof ArrayBuffer || ArrayBuffer.isView(v));
}

/** True for a naturalized binary wrapper: { InlineBinary: <content> }. */
function isInlineBinary(v) {
    return (
        v &&
        typeof v === "object" &&
        v.InlineBinary !== undefined &&
        !(v instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(v)
    );
}

/** Coerce one InlineBinary fragment (buffer, view, or base64) to bytes. */
function toBinaryFragment(fragment) {
    if (typeof fragment === "string") {
        return base64ToArrayBuffer(fragment);
    }
    return fragment;
}

function isBulkDataReference(v) {
    return (
        v &&
        typeof v === "object" &&
        typeof v.BulkDataURI === "string" &&
        !(v instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(v)
    );
}
