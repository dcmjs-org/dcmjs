/**
 * fromDicomWebJson — slice C: a DICOMweb JSON (DICOM JSON model) ->
 * event-stream generator.
 *
 * Walks a parsed DICOMweb JSON object and emits the event-stream contract,
 * proving the source-agnostic claim (§4.4): the same contract a Part 10 reader
 * produces is produced here from a third source. Implemented as a low-allocation
 * visitor that calls listener callbacks directly, without building intermediate
 * event objects (§24.1).
 *
 * Values are emitted AS-IS — Person Names stay as DICOMweb `{ Alphabetic }`
 * objects, numbers stay numbers. Cross-source value canonicalization (PN proxy,
 * IS/DS normalization, §17/§28) belongs to the naturalized listener (slice D).
 * The two binary forms are handled per spec:
 *   - `BulkDataURI`   -> bulkDataReference (nothing fetched, §21)
 *   - `InlineBinary`  -> base64 decoded to a buffer fragment (§22)
 *
 * @param {Object} json - DICOM JSON model: { "ggggeeee": { vr, Value | BulkDataURI | InlineBinary }, ... }
 * @param {import("./EventStreamListener").EventStreamListener} listener
 */
export async function fromDicomWebJson(json, listener) {
    const tags = Object.keys(json);
    const metaTags = tags.filter(isMetaTag);
    const bodyTags = tags.filter(t => !isMetaTag(t));

    listener.startDataSet({ transferSyntaxUID: transferSyntaxOf(json) });

    if (metaTags.length) {
        listener.startFileMetaInformation();
        for (const tag of metaTags) {
            emitAttribute(listener, tag, json[tag]);
        }
        listener.endFileMetaInformation();
    }

    for (const tag of bodyTags) {
        emitAttribute(listener, tag, json[tag]);
        // Top-level element boundary: a defined backpressure checkpoint.
        await listener.awaitDrain();
    }

    listener.endDataSet();
}

function emitAttribute(listener, tag, attr) {
    if (!attr) {
        return;
    }
    const vr = attr.vr;

    if (vr === "SQ") {
        listener.startSequence(tag, { vr });
        for (const item of attr.Value || []) {
            listener.startItem({});
            for (const childTag of Object.keys(item)) {
                emitAttribute(listener, childTag, item[childTag]);
            }
            listener.endItem();
        }
        listener.endSequence();
        return;
    }

    if (attr.BulkDataURI !== undefined) {
        listener.startElement(tag, { vr });
        listener.bulkDataReference({ uri: attr.BulkDataURI });
        listener.endElement();
        return;
    }

    if (attr.InlineBinary !== undefined) {
        listener.startElement(tag, { vr });
        listener.startBinary({ encapsulated: false });
        listener.binaryFragment(base64ToArrayBuffer(attr.InlineBinary));
        listener.endBinary();
        listener.endElement();
        return;
    }

    listener.startElement(tag, { vr });
    let index = 0;
    for (const v of attr.Value || []) {
        listener.value(v, { index: index++ });
    }
    listener.endElement();
}

function transferSyntaxOf(json) {
    const ts = json["00020010"];
    return ts && ts.Value ? ts.Value[0] : undefined;
}

function isMetaTag(tag) {
    return tag.slice(0, 4) === "0002";
}

/** Decode a base64 string into an ArrayBuffer (Node and browser). */
export function base64ToArrayBuffer(b64) {
    if (typeof Buffer !== "undefined") {
        const buf = Buffer.from(b64, "base64");
        return buf.buffer.slice(
            buf.byteOffset,
            buf.byteOffset + buf.byteLength
        );
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
