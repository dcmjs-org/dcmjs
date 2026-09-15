import { EventStreamListener } from "./EventStreamListener.js";
import { DicomMessage } from "../DicomMessage.js";
import { WriteBufferStream } from "../BufferStream.js";
import {
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    DEFLATED_EXPLICIT_LITTLE_ENDIAN
} from "../constants/dicom.js";

const FMI_GROUP_LENGTH = "00020000";
const TRANSFER_SYNTAX_UID = "00020010";
const UNDEFINED_LENGTH = 0xffffffff;

/**
 * StreamingPart10Writer — plan-R2: an event-stream sink that emits DICOM
 * Part 10 bytes incrementally, as events arrive, instead of collecting the
 * whole dataset first like {@link Part10Writer}.
 *
 * Purpose: writing datasets whose Pixel Data does not fit in memory (the
 * R2 trigger — e.g. a Supplement 225 fragmentable video instance measured in
 * tens of GB). Peak memory is bounded by the largest single non-encapsulated
 * element plus the file meta group; encapsulated pixel-data fragments are
 * forwarded chunk-for-chunk and never accumulated.
 *
 * Output contract: `options.onChunk(Uint8Array)` is called zero or more times
 * per event, in file order. Absent `onChunk`, chunks accumulate on
 * `this.chunks` (testing convenience; that mode is NOT streaming). The caller
 * owns backpressure: wire the generator's `setDrain` to the sink that
 * consumes the chunks (e.g. a Node fs write stream's own drain).
 *
 * Encoding decisions (all legal Part 10, all chosen to avoid backpatching):
 *  - the file meta group is buffered — it is small and its group length
 *    (0002,0000) must be computed over the encoded elements, exactly as
 *    DicomDict.write does;
 *  - sequences and their items are written with undefined length and closed
 *    with item/sequence delimitation items;
 *  - encapsulated pixel data is written with undefined length, an empty
 *    Basic Offset Table, one item per incoming fragment (odd fragments are
 *    padded), and a sequence delimiter.
 *
 * Byte-identical round-tripping remains a non-goal (spec §4.5 / D15): output
 * is correct, semantically faithful Part 10, not a byte-for-byte copy of any
 * source.
 *
 * Not supported (throws): deflated transfer syntax, bulkDataReference events
 * (the bytes are elsewhere — materialize them first), sequences inside the
 * file meta group.
 */
export class StreamingPart10Writer extends EventStreamListener {
    /**
     * @param {Object} [options]
     * @param {(chunk: Uint8Array) => void} [options.onChunk] - Byte sink;
     *        defaults to accumulating on `this.chunks`.
     * @param {Object} [options.writeOptions] - Forwarded to the element
     *        encoders (e.g. { allowInvalidVRLength }).
     * @param {...Object} filters - Event-stream filters, as for any listener.
     */
    constructor(options = {}, ...filters) {
        super(...filters);
        this.chunks = [];
        this._onChunk = options.onChunk ?? (chunk => this.chunks.push(chunk));
        this._writeOptions = options.writeOptions ?? {
            allowInvalidVRLength: false
        };
        this.bytesWritten = 0;
        this._inMeta = false;
        this._meta = {};
        this._bodySyntax = EXPLICIT_LITTLE_ENDIAN;
        this._current = null;
        this._encapsulated = false;
        this.done = false;
    }

    /** @param {ArrayBuffer|Uint8Array} bytes @private */
    _emit(bytes) {
        const chunk =
            bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        this.bytesWritten += chunk.byteLength;
        this._onChunk(chunk);
    }

    /** @private */
    _emitStream(stream) {
        this._emit(stream.getBuffer(0, stream.size));
    }

    /**
     * Writes a bare tag + 32-bit length, the form shared by item and
     * delimitation items (never a VR).
     * @private
     */
    _writeRawTag(stream, group, element, length) {
        stream.writeUint16(group);
        stream.writeUint16(element);
        stream.writeUint32(length);
    }

    /**
     * Writes an element header in the long (reserved + 32-bit length) form —
     * the only form needed for the headers this writer emits itself (SQ and
     * encapsulated OB/OW/UN); everything else goes through
     * DicomMessage.writeTagObject.
     * @private
     */
    _writeLongHeader(stream, tag, vr, length) {
        stream.writeUint16(parseInt(tag.substring(0, 4), 16));
        stream.writeUint16(parseInt(tag.substring(4, 8), 16));
        if (this._bodySyntax !== IMPLICIT_LITTLE_ENDIAN) {
            stream.writeAsciiString(vr);
            stream.writeUint16(0);
        }
        stream.writeUint32(length);
    }

    _baseStartDataSet() {}

    _baseEndDataSet() {
        this.done = true;
    }

    _baseStartFileMetaInformation() {
        this._inMeta = true;
        const stream = new WriteBufferStream(160, true);
        stream.writeUint8Repeat(0, 128);
        stream.writeAsciiString("DICM");
        this._emitStream(stream);
    }

    _baseEndFileMetaInformation() {
        this._inMeta = false;
        if (!this._meta[TRANSFER_SYNTAX_UID]) {
            this._meta[TRANSFER_SYNTAX_UID] = {
                vr: "UI",
                Value: [EXPLICIT_LITTLE_ENDIAN]
            };
        }
        this._bodySyntax = this._meta[TRANSFER_SYNTAX_UID].Value[0];
        if (this._bodySyntax === DEFLATED_EXPLICIT_LITTLE_ENDIAN) {
            throw new Error(
                "StreamingPart10Writer does not support the deflated " +
                    "transfer syntax; inflate the source or use Part10Writer"
            );
        }
        // Group length must cover the encoded meta elements, so the group is
        // the one part of the file that cannot stream element-by-element.
        delete this._meta[FMI_GROUP_LENGTH];
        const metaStream = new WriteBufferStream(1024, true);
        DicomMessage.write(
            this._meta,
            metaStream,
            EXPLICIT_LITTLE_ENDIAN,
            this._writeOptions
        );
        const out = new WriteBufferStream(1024 + 16, true);
        DicomMessage.writeTagObject(
            out,
            FMI_GROUP_LENGTH,
            "UL",
            metaStream.size,
            EXPLICIT_LITTLE_ENDIAN,
            this._writeOptions
        );
        out.concat(metaStream);
        this._emitStream(out);
        this._meta = {};
    }

    _baseStartElement(tag, info = {}) {
        this._current = { tag, vr: info.vr, values: [], emitted: false };
    }

    _baseValue(v) {
        this._current.values.push(v);
    }

    _baseEndElement() {
        const el = this._current;
        this._current = null;
        if (el.emitted) {
            return; // encapsulated path already streamed it
        }
        if (this._inMeta) {
            if (el.tag !== FMI_GROUP_LENGTH) {
                this._meta[el.tag] = { vr: el.vr, Value: el.values };
            }
            return;
        }
        const stream = new WriteBufferStream(256, true);
        DicomMessage.writeTagObject(
            stream,
            el.tag,
            el.vr,
            el.values,
            this._bodySyntax,
            this._writeOptions
        );
        this._emitStream(stream);
    }

    _baseStartBinary(opts = {}) {
        if (opts.encapsulated && this._inMeta) {
            throw new Error(
                "encapsulated binary is not legal in the file meta group"
            );
        }
        if (!opts.encapsulated) {
            // Defined-length binary: fragments accumulate on the element and
            // endElement serializes it whole (bounded by that one element).
            this._encapsulated = false;
            return;
        }
        this._encapsulated = true;
        this._current.emitted = true;
        const stream = new WriteBufferStream(24, true);
        this._writeLongHeader(
            stream,
            this._current.tag,
            this._current.vr || "OB",
            UNDEFINED_LENGTH
        );
        // Empty Basic Offset Table: generators emit data fragments only (the
        // source table, if any, indexes source offsets that no longer hold).
        this._writeRawTag(stream, 0xfffe, 0xe000, 0);
        this._emitStream(stream);
    }

    _baseBinaryFragment(chunk) {
        const bytes =
            chunk instanceof Uint8Array
                ? chunk
                : chunk instanceof ArrayBuffer
                ? new Uint8Array(chunk)
                : new Uint8Array(
                      chunk.buffer,
                      chunk.byteOffset,
                      chunk.byteLength
                  );
        if (!this._encapsulated) {
            this._current.values.push(bytes.buffer);
            return;
        }
        const pad = bytes.byteLength % 2;
        const header = new WriteBufferStream(8, true);
        this._writeRawTag(header, 0xfffe, 0xe000, bytes.byteLength + pad);
        this._emitStream(header);
        this._emit(bytes);
        if (pad) {
            this._emit(new Uint8Array(1));
        }
    }

    _baseEndBinary() {
        if (this._encapsulated) {
            const stream = new WriteBufferStream(8, true);
            this._writeRawTag(stream, 0xfffe, 0xe0dd, 0);
            this._emitStream(stream);
            this._encapsulated = false;
        }
    }

    _baseStartSequence(tag, info = {}) {
        if (this._inMeta) {
            throw new Error("sequences are not legal in the file meta group");
        }
        // Undefined length streams without backpatching; items and the
        // delimiters below close it out (PS3.5 §7.5).
        const stream = new WriteBufferStream(16, true);
        this._writeLongHeader(stream, tag, info.vr || "SQ", UNDEFINED_LENGTH);
        this._emitStream(stream);
    }

    _baseStartItem() {
        const stream = new WriteBufferStream(8, true);
        this._writeRawTag(stream, 0xfffe, 0xe000, UNDEFINED_LENGTH);
        this._emitStream(stream);
    }

    _baseEndItem() {
        const stream = new WriteBufferStream(8, true);
        this._writeRawTag(stream, 0xfffe, 0xe00d, 0);
        this._emitStream(stream);
    }

    _baseEndSequence() {
        const stream = new WriteBufferStream(8, true);
        this._writeRawTag(stream, 0xfffe, 0xe0dd, 0);
        this._emitStream(stream);
    }

    _baseBulkDataReference(ref = {}) {
        throw new Error(
            "StreamingPart10Writer cannot serialize a bulkDataReference " +
                `(${ref.uri ?? "no uri"}); materialize bulk data before writing`
        );
    }

    /**
     * Testing convenience for the accumulate mode: the collected chunks as
     * one ArrayBuffer. Meaningless when onChunk was provided.
     * @returns {ArrayBuffer}
     */
    toArrayBuffer() {
        const total = this.chunks.reduce((n, c) => n + c.byteLength, 0);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of this.chunks) {
            out.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return out.buffer;
    }
}
