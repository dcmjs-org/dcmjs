import pako from "pako";
import SplitDataView from "./SplitDataView";

function toInt(val) {
    if (isNaN(val)) {
        throw new Error("Not a number: " + val);
    } else if (typeof val == "string") {
        return parseInt(val);
    } else return val;
}

function toFloat(val) {
    if (typeof val == "string") {
        return parseFloat(val);
    } else return val;
}

class BufferStream {
    offset = 0;
    startOffset = 0;
    isLittleEndian = false;
    size = 0;
    view = new SplitDataView();

    isComplete = false;

    /**
     * Set the option clearBuffers to true to set the buffer objects to null
     * once they are read or written.
     */
    clearBuffers = false;

    encoder = new TextEncoder("utf-8");

    constructor(options = null) {
        this.isLittleEndian = options?.littleEndian || this.isLittleEndian;
        this.view.defaultSize = options?.defaultSize ?? this.view.defaultSize;

        this.view.clearBuffers = options?.clearBuffers || false;
        this.view.consumeListener = options?.consumeListener;
    }

    setEndian(isLittle) {
        this.isLittleEndian = isLittle;
    }

    slice(start = this.startOffset, end = this.endOffset) {
        return this.view.slice(start, end);
    }

    getBuffer(start = 0, end = this.size) {
        if (this.noCopy) {
            return new Uint8Array(this.slice(start, end));
        }

        return this.slice(start, end);
    }

    /**
     * @deprecated Gets the entire buffer at once.  Suggest using the
     *     view instead, and writing an iterator over the parts to finish
     *     writing it.
     */
    get buffer() {
        // console.warn("Deprecated buffer get");
        return this.getBuffer();
    }

    /**
     * Returns the number of bytes that are currently available for reading
     */
    get available() {
        return this.endOffset - this.offset;
    }

    get complete() {
        return this.isComplete;
    }

    /**
     * Mark this stream as having finished being written or read from
     */
    setComplete(value = true) {
        this.isComplete = value;
    }

    /**
     * Indicates if the value length is currently available in the already
     * read/defined portion of the stream
     */
    isAvailable(length) {
        return this.offset + length < this.endOffset;
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

    writeInt32(value) {
        this.checkSize(4);
        this.view.setInt32(this.offset, toInt(value), this.isLittleEndian);
        return this.increment(4);
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
        const arr = new Uint8Array(
            this.view.slice(this.offset, this.offset + length)
        );
        this.increment(length);
        return arr;
    }

    readUint16Array(length) {
        var sixlen = length / 2,
            arr = new Uint16Array(sixlen),
            i = 0;
        while (i++ < sixlen) {
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

    readEncodedString(length) {
        if (this.offset + length >= this.view.byteLength) {
            length = this.view.byteLength - this.offset;
        }
        const view = new DataView(
            this.slice(this.offset, this.offset + length)
        );
        const result = this.decoder.decode(view);
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

    /**
     * Ensures there is enough data to write the given data, and also write
     * any filled/completed buffers out.
     */
    checkSize(step) {
        this.view.checkSize(this.offset + step);
        // Leave at least 32 bytes free before current
        this.view.consume(this.offset - 32);
    }

    /**
     * Concatenates the stream, starting from the startOffset (to allow concat
     * on an existing output from the beginning)
     */
    concat(stream) {
        this.view.checkSize(this.size + stream.size - stream.startOffset);
        this.view.writeBuffer(
            new Uint8Array(stream.slice(stream.startOffset, stream.size)),
            this.offset
        );
        this.offset += stream.size;
        this.size = this.offset;
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
     * Adds the buffer to the end of the current buffers list,
     * updating the size etc.
     *
     * @param {*} buffer
     * @param {*} options.start for the start of the new buffer to use
     * @param {*} options.end for the end of the buffer to use
     * @param {*} options.transfer to transfer the buffer to be owned
     */
    addBuffer(buffer, options = null) {
        this.view.addBuffer(buffer, options);
        this.size = this.view.size;
        return this.size;
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
        this.increment(length);

        return newBuf;
    }

    reset() {
        if (this.clearedBuffer >= 0) {
            throw new Error(
                `Buffers have been cleared to ${this.clearedBuffer}, can't reset any longer`
            );
        }
        if (this.writeOffset >= 0) {
            throw new Error(
                `Buffers have already been written up to offset ${this.writeOffset}, can no longer reset`
            );
        }
        this.offset = 0;
        return this;
    }

    end() {
        return this.offset >= this.view.byteLength;
    }

    toEnd() {
        this.offset = this.view.byteLength;
    }

    /**
     * Indicates that data up to the given offset has been consumed or is
     * ready to be consumed and should be cleared appropriately.
     */
    consume(offset = this.offset) {
        this.view.consume(offset);
    }
}

class ReadBufferStream extends BufferStream {
    constructor(
        buffer,
        littleEndian,
        options = {
            start: null,
            stop: null,
            noCopy: false,
            clearBuffer: false
        }
    ) {
        super({ littleEndian, ...options });
        this.noCopy = options.noCopy;
        this.decoder = new TextDecoder("latin1");

        if (buffer instanceof BufferStream) {
            this.view.from(buffer.view, options);
        } else if (buffer) {
            this.view.addBuffer(buffer);
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
        return this.offset >= this.endOffset;
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

    checkSize(step) {
        throw new Error(step, "checkSize not implemented");
    }

    concat(stream) {
        throw new Error(stream, "concat not implemented");
    }
}

class DeflatedReadBufferStream extends ReadBufferStream {
    constructor(stream, options) {
        const inflatedBuffer = pako.inflateRaw(
            stream.getBuffer(stream.offset, stream.size)
        );
        super(inflatedBuffer.buffer, stream.littleEndian, options);
    }
}

class WriteBufferStream extends BufferStream {
    constructor(
        defaultSize,
        littleEndian,
        options = {
            clearBuffer: false,
            writeListener: null
        }
    ) {
        super({ ...options, defaultSize, littleEndian });
        this.size = 0;
    }
}

export { ReadBufferStream };
export { DeflatedReadBufferStream };
export { WriteBufferStream };
