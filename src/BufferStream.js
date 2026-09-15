import pako from "pako";
import SplitDataView from "./SplitDataView";
import { createLatin1Decoder } from "./charset/latin1.js";
import { toFloat } from "./utilities/toFloat";
import { toInt } from "./utilities/toInt";

/**
 * Raw spans at least this large are appended as zero-copy windows over the
 * caller's buffer instead of being copied into the stream's own chunks.
 * Each window adds one chunk to the SplitDataView (chunk lookups are a
 * linear scan), so only spans worth a saved memcpy get one.
 */
const RAW_ZERO_COPY_THRESHOLD = 64 * 1024;

/**
 * Shared default encoder/decoder singletons. Streams are created per
 * sequence item / fragment / element, so constructing a TextEncoder or
 * TextDecoder per stream is measurable overhead. Both are stateless here
 * (decode/encode are always called without {stream: true}), so sharing is
 * safe. setDecoder still installs a per-stream decoder on the instance
 * when SpecificCharacterSet changes - it never mutates these defaults.
 */
const DEFAULT_ENCODER = new TextEncoder();
// Guarded construction (#297): on runtimes without a latin1 TextDecoder this
// falls back to a pure-JS byte->code-point decoder instead of throwing at
// module load.
const DEFAULT_LATIN1_DECODER = createLatin1Decoder();

export class BufferStream {
    offset = 0;
    startOffset = 0;
    isLittleEndian = false;
    size = 0;
    view = new SplitDataView();
    /** The available listeners are those waiting for a query response */
    availableListeners = [];

    /**
     * Waiters for relay-style producers: resolved whenever the consumer
     * makes progress (consume) or registers new demand (ensureAvailable
     * going async). Lets a producer throttle itself against the parse
     * loop instead of running unboundedly ahead (K5 relay-balloon fix).
     */
    relayListeners = [];

    /** Indicates if this buffer stream is complete/has finished being created */
    isComplete = false;

    /** A flag to set to indicate to clear buffers as they get consumed */
    clearBuffers = false;

    encoder = DEFAULT_ENCODER;

    constructor(options = null) {
        this.isLittleEndian = options?.littleEndian || this.isLittleEndian;
        this.view.defaultSize = options?.defaultSize ?? this.view.defaultSize;
        this.clearBuffers = options.clearBuffers || false;
    }

    /**
     * Mark this stream as having finished being written or read from
     */
    setComplete(value = true) {
        this.isComplete = value;
        this.notifyAvailableListeners();
        this.notifyRelayListeners();
    }

    /**
     * Indicates if the value length is currently available in the already
     * read/defined portion of the stream.
     *
     * By default this will test if the buffer is complete as well,
     * but this can be changed with orComplete=false.
     */
    isAvailable(length, orComplete = true) {
        return (
            this.offset + length <= this.endOffset ||
            (orComplete && this.isComplete)
        );
    }

    /**
     * Ensures that the specified number of bytes are available OR that it is
     * EOF.  By default waits for at least 1k to be available.
     */
    ensureAvailable(bytes = 1024) {
        if (!this.isAvailable(bytes)) {
            return new Promise(resolve => {
                const recheckAvailable = () => {
                    if (this.isAvailable(bytes)) {
                        resolve(true);
                        return;
                    }
                    this.availableListeners.push(recheckAvailable);
                    // Demand appeared — wake any throttled producer so a
                    // starved consumer can never deadlock against it.
                    this.notifyRelayListeners();
                };
                recheckAvailable();
            });
        }
        return true;
    }

    /** True when a consumer is blocked waiting for more bytes. */
    hasPendingDemand() {
        return this.availableListeners.length > 0;
    }

    /** Resolves on the next consumer activity (consume or new demand). */
    awaitConsumerActivity() {
        return new Promise(resolve => this.relayListeners.push(resolve));
    }

    notifyRelayListeners() {
        const existingListeners = [...this.relayListeners];
        this.relayListeners.splice(0, this.relayListeners.length);
        existingListeners.forEach(listener => listener());
    }

    setEndian(isLittle) {
        this.isLittleEndian = isLittle;
    }

    slice(start = this.startOffset, end = this.endOffset) {
        return this.view.slice(start, end);
    }

    /**
     * @deprecated Gets the entire buffer at once.  Suggest using the
     *     view instead, and writing an iterator over the parts to finish
     *     writing it.
     */
    getBuffer(start = 0, end = this.size) {
        if (this.noCopy) {
            return new Uint8Array(this.slice(start, end));
        }

        return this.slice(start, end);
    }

    get buffer() {
        // console.warn("Deprecated buffer get");
        return this.getBuffer();
    }

    get available() {
        return this.endOffset - this.offset;
    }

    writeUint8(value) {
        this.checkSize(1);
        this.view.setUint8(this.offset, toInt(value));
        return this.increment(1);
    }

    writeUint8Repeat(value, count) {
        const v = toInt(value);
        this.checkSize(count);
        for (let i = 0; i < count; i++) {
            this.view.setUint8(this.offset + i, v);
        }
        return this.increment(count);
    }

    writeInt8(value) {
        this.checkSize(1);
        this.view.setInt8(this.offset, toInt(value));
        return this.increment(1);
    }

    writeUint16(value) {
        this.checkSize(2);
        this.view.setUint16(this.offset, toInt(value), this.isLittleEndian);
        return this.increment(2);
    }

    writeTwoUint16s(value) {
        this.checkSize(4);
        const first = value >> 16;
        const second = value & 0xffff;
        this.view.setUint16(this.offset, toInt(first), this.isLittleEndian);
        this.view.setUint16(
            this.offset + 2,
            toInt(second),
            this.isLittleEndian
        );
        return this.increment(4);
    }

    writeInt16(value) {
        this.checkSize(2);
        this.view.setInt16(this.offset, toInt(value), this.isLittleEndian);
        return this.increment(2);
    }

    writeUint32(value) {
        this.checkSize(4);
        this.view.setUint32(this.offset, toInt(value), this.isLittleEndian);
        return this.increment(4);
    }

    /**
     * Writes a Uint16 at an absolute, already-written offset without moving
     * the stream position. Used to backpatch explicit VR 2-byte length
     * fields once the value bytes are in place.
     */
    writeUint16At(offset, value) {
        this.view.setUint16(offset, toInt(value), this.isLittleEndian);
    }

    /**
     * Writes a Uint32 at an absolute, already-written offset without moving
     * the stream position. Used to backpatch 4-byte length fields once the
     * value bytes are in place.
     */
    writeUint32At(offset, value) {
        this.view.setUint32(offset, toInt(value), this.isLittleEndian);
    }

    writeInt32(value) {
        this.checkSize(4);
        this.view.setInt32(this.offset, toInt(value), this.isLittleEndian);
        return this.increment(4);
    }

    writeBigUint64(value) {
        this.checkSize(8);
        this.view.setBigUint64(this.offset, value, this.isLittleEndian);
        return this.increment(8);
    }

    writeFloat(value) {
        this.checkSize(4);
        this.view.setFloat32(this.offset, toFloat(value), this.isLittleEndian);
        return this.increment(4);
    }

    writeDouble(value) {
        this.checkSize(8);
        this.view.setFloat64(this.offset, toFloat(value), this.isLittleEndian);
        return this.increment(8);
    }

    writeUTF8String(value) {
        const encodedString = this.encoder.encode(value);
        this.checkSize(encodedString.byteLength);
        this.view.writeBuffer(encodedString, this.offset);
        return this.increment(encodedString.byteLength);
    }

    writeAsciiString(value) {
        value = value || "";
        var len = value.length;
        this.checkSize(len);
        var startOffset = this.offset;
        for (let i = 0; i < len; i++) {
            const charCode = value.charCodeAt(i);
            this.view.setUint8(startOffset + i, charCode);
        }
        return this.increment(len);
    }

    /**
     * Appends raw, already-encoded bytes (a passthrough source span) at the
     * current write position and returns the number of bytes written.
     *
     * Spans of at least RAW_ZERO_COPY_THRESHOLD bytes appended at the end
     * of the stream become zero-copy read-only windows over the caller's
     * buffer (the bytes are referenced, not copied - the caller must not
     * mutate them afterwards); anything else is copied straight into the
     * stream with a single set.
     */
    writeRawBytes(bytes) {
        const length = bytes.byteLength;
        if (length === 0) {
            return 0;
        }
        if (length >= RAW_ZERO_COPY_THRESHOLD && this.offset === this.size) {
            this.view.addZeroCopyWindow(bytes, this.offset);
            return this.increment(length);
        }
        this.checkSize(length);
        this.view.writeBuffer(bytes, this.offset);
        return this.increment(length);
    }

    readBigUint64() {
        var val = this.view.getBigUint64(this.offset, this.isLittleEndian);
        this.increment(8);
        return val;
    }

    readUint32() {
        var val = this.view.getUint32(this.offset, this.isLittleEndian);
        this.increment(4);
        return val;
    }

    readUint16() {
        var val = this.view.getUint16(this.offset, this.isLittleEndian);
        this.increment(2);
        return val;
    }

    readUint8() {
        var val = this.view.getUint8(this.offset);
        this.increment(1);
        return val;
    }

    peekUint8(offset) {
        return this.view.getUint8(this.offset + offset);
    }

    readUint8Array(length) {
        if (this.offset + length > this.endOffset) {
            throw new Error(
                `Stream has insufficient data: requested ${length} bytes at offset ${
                    this.offset
                }, but only ${
                    this.endOffset - this.offset
                } bytes available (endOffset ${this.endOffset})`
            );
        }
        const arr = new Uint8Array(
            this.view.slice(this.offset, this.offset + length)
        );
        this.increment(length);
        return arr;
    }

    readArrayBuffer(length) {
        return this.readUint8Array(length).buffer;
    }

    readUint16Array(length) {
        const count = length / 2;
        const arr = new Uint16Array(count);
        for (let i = 0; i < count; i++) {
            arr[i] = this.view.getUint16(this.offset, this.isLittleEndian);
            this.offset += 2;
        }
        return arr;
    }

    readInt8() {
        var val = this.view.getInt8(this.offset, this.isLittleEndian);
        this.increment(1);
        return val;
    }

    readInt16() {
        var val = this.view.getInt16(this.offset, this.isLittleEndian);
        this.increment(2);
        return val;
    }

    readInt32() {
        var val = this.view.getInt32(this.offset, this.isLittleEndian);
        this.increment(4);
        return val;
    }

    readFloat() {
        var val = this.view.getFloat32(this.offset, this.isLittleEndian);
        this.increment(4);
        return val;
    }

    readDouble() {
        var val = this.view.getFloat64(this.offset, this.isLittleEndian);
        this.increment(8);
        return val;
    }

    readAsciiString(length) {
        var result = "";
        var start = this.offset;
        var end = this.offset + length;
        if (end >= this.view.byteLength) {
            end = this.view.byteLength;
        }
        for (let i = start; i < end; ++i) {
            result += String.fromCharCode(this.view.getUint8(i));
        }
        this.increment(end - start);
        return result;
    }

    readVR() {
        var vr =
            String.fromCharCode(this.view.getUint8(this.offset)) +
            String.fromCharCode(this.view.getUint8(this.offset + 1));
        this.increment(2);
        return vr;
    }

    /**
     * Decodes `length` bytes with the stream's active decoder.
     * `delimiters` (optional Set of byte values) is forwarded to ISO 2022
     * aware decoders as extra designation-reset delimiters (e.g. PN's ^/=);
     * plain TextDecoders ignore it.
     */
    readEncodedString(length, delimiters) {
        if (this.offset + length >= this.view.byteLength) {
            length = this.view.byteLength - this.offset;
        }
        const view = new DataView(
            this.slice(this.offset, this.offset + length)
        );
        const result = delimiters
            ? this.decoder.decode(view, { delimiters })
            : this.decoder.decode(view);
        this.increment(length);
        return result;
    }

    readHex(length) {
        var hexString = "";
        for (var i = 0; i < length; i++) {
            hexString += this.readUint8().toString(16);
        }
        return hexString;
    }

    checkSize(step) {
        this.view.checkSize(this.offset + step);
    }

    /**
     * Concatenates the stream, starting from the startOffset (to allow concat
     * on an existing output from the beginning).
     *
     * Copies the source chunks straight into this view, without first
     * merging the source stream into one intermediate buffer.
     */
    concat(stream) {
        const startOffset = stream.startOffset;
        const length = stream.size - startOffset;
        this.view.checkSize(this.size + length);
        let copied = 0;
        while (copied < length) {
            const position = startOffset + copied;
            const index = stream.view.findStart(position);
            const chunkStart = position - stream.view.offsets[index];
            const copyLength = Math.min(
                stream.view.lengths[index] - chunkStart,
                length - copied
            );
            this.view.writeBuffer(
                new Uint8Array(
                    stream.view.buffers[index],
                    // zero-copy window chunks start at their view's
                    // byteOffset within the shared source buffer
                    chunkStart + stream.view.views[index].byteOffset,
                    copyLength
                ),
                this.offset + copied
            );
            copied += copyLength;
        }
        this.offset += stream.size;
        this.size = this.offset;
        this.endOffset = this.size;
        return this.view.availableSize;
    }

    increment(step) {
        this.offset += step;
        if (this.offset > this.size) {
            this.size = this.offset;
        }
        return step;
    }

    /**
     * Reads from an async stream delivering to addBuffer.
     */
    async fromAsyncStream(stream) {
        for await (const chunk of stream) {
            const ab = chunk.buffer.slice(
                chunk.byteOffset,
                chunk.byteOffset + chunk.byteLength
            );
            this.addBuffer(ab);
        }
        this.setComplete();
    }

    /**
     * Adds the buffer to the end of the current buffers list,
     * updating the size etc.
     *
     * @param {*} buffer
     * @param {*} options.start for the start of the new buffer to use
     * @param {*} options.end for the end of the buffer to use
     * @param {*} options.transfer to transfer the buffer to be owned
     *     Transfer will default true if the entire buffer is being added.
     *     It should be set explicitly to false to NOT transfer.
     */
    addBuffer(buffer, options = null) {
        if (!buffer) {
            // Silently ignore null buffers.
            return;
        }
        this.view.addBuffer(buffer, options);
        this.size = this.view.size;
        this.endOffset = this.size;
        this.notifyAvailableListeners();
        return this.size;
    }

    notifyAvailableListeners() {
        const existingListeners = [...this.availableListeners];
        this.availableListeners.splice(0, this.availableListeners.length);
        existingListeners.forEach(listener => listener());
    }

    /**
     * Consumes the data up to the given offset.
     * This will clear the references to the data buffers, and will
     * cause resets etc to fail.
     * The default offset is the current position, so everything already read.
     */
    consume(offset = this.offset) {
        if (!this.clearBuffers) {
            return;
        }
        this.view.consume(offset);
        this.notifyRelayListeners();
    }

    /**
     * Returns true if the stream has data in the given range.
     */
    hasData(start, end = start + 1) {
        return this.view.hasData(start, end);
    }

    more(length) {
        if (this.offset + length > this.endOffset) {
            throw new Error("Request more than currently allocated buffer");
        }

        // Optimize the more implementation to choose between a slice and
        // a sub-string reference to the original set of views.
        // const newBuf = new ReadBufferStream(this.buffer, null, {
        //   start: this.offset,
        //   stop: this.offset + length
        // });
        const newBuf = new ReadBufferStream(
            this.slice(this.offset, this.offset + length)
        );
        // Propagate the active charset decoder into the substream so
        // sequence-item datasets decode with the dataset's
        // SpecificCharacterSet instead of the default latin1 (#503/#451).
        if (this.decoder) {
            newBuf.setDecoder(this.decoder);
        }
        this.increment(length);
        newBuf.setComplete();

        return newBuf;
    }

    reset() {
        this.offset = 0;
        return this;
    }

    end() {
        return this.isComplete && this.offset >= this.end;
    }

    toEnd() {
        this.offset = this.view.byteLength;
    }

    /**
     * Reports on the amount of memory held by the buffers in the view.
     * @returns {Object} An object containing:
     *   - bufferCount: Number of buffers still held (not null)
     *   - totalSize: Total size of all buffers in bytes
     *   - consumeOffset: The current consume offset
     *   - buffersBeforeOffset: Number of buffers before the consume offset
     */
    getBufferMemoryInfo() {
        return this.view.getBufferMemoryInfo(this.offset);
    }
}

export class ReadBufferStream extends BufferStream {
    constructor(
        buffer,
        littleEndian,
        options = {
            start: null,
            stop: null,
            noCopy: false
        }
    ) {
        super({ ...options, littleEndian });
        this.noCopy = options.noCopy;
        this.decoder = DEFAULT_LATIN1_DECODER;

        if (buffer instanceof BufferStream) {
            this.view.from(buffer.view, options);
            this.isComplete = true;
        } else if (buffer) {
            this.view.addBuffer(buffer);
            this.isComplete = true;
        }
        this.offset = options.start ?? buffer?.offset ?? 0;
        this.size = options.stop || buffer?.size || buffer?.byteLength || 0;

        this.startOffset = this.offset;
        this.endOffset = this.size;
    }

    setDecoder(decoder) {
        this.decoder = decoder;
    }

    reset() {
        this.offset = this.startOffset;
        return this;
    }

    end() {
        return this.isComplete && this.offset >= this.endOffset;
    }

    toEnd() {
        this.offset = this.endOffset;
    }

    writeUint8(value) {
        throw new Error(value, "writeUint8 not implemented");
    }

    writeUint8Repeat(value, count) {
        throw new Error(
            `writeUint8Repeat not implemented (value: ${value}, count: ${count})`
        );
    }

    writeInt8(value) {
        throw new Error(value, "writeInt8 not implemented");
    }

    writeUint16(value) {
        throw new Error(value, "writeUint16 not implemented");
    }

    writeTwoUint16s(value) {
        throw new Error(value, "writeTwoUint16s not implemented");
    }

    writeInt16(value) {
        throw new Error(value, "writeInt16 not implemented");
    }

    writeUint32(value) {
        throw new Error(value, "writeUint32 not implemented");
    }

    writeUint16At(offset, value) {
        throw new Error(value, "writeUint16At not implemented");
    }

    writeUint32At(offset, value) {
        throw new Error(value, "writeUint32At not implemented");
    }

    writeInt32(value) {
        throw new Error(value, "writeInt32 not implemented");
    }

    writeFloat(value) {
        throw new Error(value, "writeFloat not implemented");
    }

    writeDouble(value) {
        throw new Error(value, "writeDouble not implemented");
    }

    writeAsciiString(value) {
        throw new Error(value, "writeAsciiString not implemented");
    }

    writeUTF8String(value) {
        throw new Error(value, "writeUTF8String not implemented");
    }

    writeRawBytes(bytes) {
        throw new Error(bytes, "writeRawBytes not implemented");
    }

    checkSize(step) {
        throw new Error(step, "checkSize not implemented");
    }

    concat(stream) {
        throw new Error(stream, "concat not implemented");
    }
}

export class DeflatedReadBufferStream extends ReadBufferStream {
    constructor(stream, options) {
        const inflatedBuffer = pako.inflateRaw(
            stream.getBuffer(stream.offset, stream.size)
        );
        super(inflatedBuffer.buffer, stream.littleEndian, options);
    }
}

export class WriteBufferStream extends BufferStream {
    constructor(defaultSize, littleEndian) {
        super({ defaultSize, littleEndian });
        this.size = 0;
    }
}
