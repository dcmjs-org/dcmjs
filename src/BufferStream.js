import pako from "pako";
import SplitDataView from "./SplitDataView";
import { toFloat } from "./utilities/toFloat";
import { toInt } from "./utilities/toInt";

export class BufferStream {
    offset = 0;
    startOffset = 0;
    isLittleEndian = false;
    size = 0;
    view = new SplitDataView();
    /** The available listeners are those waiting for a query response */
    availableListeners = [];
    readAheadListeners = [];
    requestedAvailable = 0;

    /** Indicates if this buffer stream is complete/has finished being created */
    isComplete = false;
    failure = null;

    /** A flag to set to indicate to clear buffers as they get consumed */
    clearBuffers = false;

    encoder = new TextEncoder("utf-8");

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
        this.notifyReadAheadListeners();
    }

    setFailed(error) {
        this.failure = error;
        this.setComplete();
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
        if (this.failure) {
            return Promise.reject(this.failure);
        }
        if (!this.isAvailable(bytes)) {
            this.requestedAvailable = Math.max(this.requestedAvailable, bytes);
            this.notifyReadAheadListeners();
            return new Promise((resolve, reject) => {
                const recheckAvailable = () => {
                    if (this.failure) {
                        reject(this.failure);
                        return;
                    }
                    if (this.isAvailable(bytes)) {
                        if (this.requestedAvailable <= bytes) {
                            this.requestedAvailable = 0;
                        }
                        this.notifyReadAheadListeners();
                        resolve(true);
                        return;
                    }
                    this.availableListeners.push(recheckAvailable);
                };
                recheckAvailable();
            });
        }
        return true;
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
        var sixlen = length / 2,
            arr = new Uint16Array(sixlen);
        for (let i = 0; i < sixlen; i++) {
            arr[i] = this.view.getUint16(this.offset, this.isLittleEndian);
            this.increment(2);
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

    checkSize(step) {
        this.view.checkSize(this.offset + step);
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
        this.increment(stream.size);
        this.size = this.offset;
        this.endOffset = this.size;
        return this.view.availableSize;
    }

    increment(step) {
        this.offset += step;
        if (this.offset > this.size) {
            this.size = this.offset;
        }
        if (this.readAheadListeners.length > 0) {
            this.notifyReadAheadListeners();
        }
        if (step < 0 && this.availableListeners.length > 0) {
            this.notifyAvailableListeners();
        }
        return step;
    }

    /**
     * Reads from an async stream delivering to addBuffer.
     */
    async fromAsyncStream(stream, options = {}) {
        return this.pumpAsyncStream(stream, options).finished;
    }

    /**
     * Starts reading from an async stream and returns a handle that can abort
     * the source without requiring callers to read the rest of it first.
     */
    pumpAsyncStream(stream, options = {}) {
        if (
            options.requireCancellation &&
            !BufferStream.isCancellableAsyncStream(stream)
        ) {
            throw new TypeError(
                "Cancellable stream must be a Node stream or ReadableStream"
            );
        }
        const source = BufferStream.asyncSourceFromStream(stream);
        let rejectFailure;
        let resolveStop;
        const failure = new Promise((_resolve, reject) => {
            rejectFailure = reject;
        });
        failure.catch(() => {});
        const stopSignal = new Promise(resolve => {
            resolveStop = resolve;
        });
        const state = {
            cancelRequested: false,
            cancelPromise: Promise.resolve(),
            finalizing: false,
            failure: undefined,
            hasFailure: false,
            settled: false,
            stopSignal,
            stopped: false
        };

        const reportFailure = error => {
            if (state.hasFailure) {
                return;
            }
            const failure = BufferStream.toError(error, "Async stream failed");
            state.failure = failure;
            state.hasFailure = true;
            rejectFailure(failure);
            this.setFailed(failure);
        };

        const cancel = error => {
            if (error !== undefined) {
                reportFailure(error);
            }
            if (state.cancelRequested || state.finalizing || state.settled) {
                return;
            }
            state.cancelRequested = true;
            state.stopped = true;
            resolveStop();
            const cancelSource =
                error !== undefined ? source.abort : source.stop;
            const reason =
                error !== undefined
                    ? state.failure
                    : BufferStream.createStopReason();
            state.cancelPromise = BufferStream.cancelSource(
                cancelSource,
                reason
            );
            if (error === undefined) {
                this.setComplete();
            }
        };
        state.cancel = cancel;
        state.reportFailure = reportFailure;
        state.removeErrorListener = source.onError?.(error =>
            cancel(BufferStream.toError(error, "Async source failed"))
        );

        const finished = this._pumpAsyncStream(source, state, options);
        finished.catch(() => {});

        return {
            abort: error => cancel(BufferStream.toError(error)),
            cancellable: source.cancellable,
            failure,
            finished,
            stop: () => cancel(),
            get aborted() {
                return state.hasFailure;
            },
            get reason() {
                return state.failure;
            },
            get stopped() {
                return state.stopped;
            }
        };
    }

    async _pumpAsyncStream(source, state, options) {
        let reachedEnd = false;
        try {
            while (!state.stopped) {
                const next = Promise.resolve()
                    .then(() => source.next())
                    .then(result => ({ result }));
                const nextResult = await Promise.race([next, state.stopSignal]);
                if (!nextResult || state.stopped) {
                    break;
                }
                const { done, value } = nextResult.result;
                if (done) {
                    reachedEnd = true;
                    break;
                }
                this.addBuffer(BufferStream.arrayBufferFromChunk(value));
                await this.waitForReadAhead(
                    options.readAheadHighWaterMark,
                    state
                );
            }
        } catch (error) {
            const expectedStopError =
                state.stopped &&
                !state.hasFailure &&
                source.isExpectedStopError?.(error);
            const isReportedFailure =
                state.hasFailure && error === state.failure;
            if (!expectedStopError && !isReportedFailure) {
                state.cancel(
                    BufferStream.toError(error, "Async source failed")
                );
            }
        } finally {
            if (
                reachedEnd &&
                options.requireCancellation &&
                !state.cancelRequested
            ) {
                state.cancel();
            }
            state.finalizing = true;
            try {
                await state.cancelPromise;
            } catch (error) {
                state.reportFailure(error);
            } finally {
                try {
                    source.release?.();
                } catch (error) {
                    state.reportFailure(error);
                }
                state.removeErrorListener?.();
                state.settled = true;
                if (!state.hasFailure) {
                    this.setComplete();
                }
            }
        }

        if (state.hasFailure) {
            throw state.failure;
        }
    }

    static createStopReason() {
        return new Error("BufferStream stopped");
    }

    static toError(error, fallbackMessage = "BufferStream aborted") {
        if (error instanceof Error) {
            return error;
        }
        return new Error(error ? String(error) : fallbackMessage);
    }

    static cancelSource(cancelSource, reason) {
        try {
            return Promise.resolve(cancelSource?.(reason));
        } catch (error) {
            return Promise.reject(error);
        }
    }

    static isCancellableAsyncStream(stream) {
        if (typeof stream?.getReader === "function") {
            return true;
        }
        return (
            typeof stream?.[Symbol.asyncIterator] === "function" &&
            typeof stream.destroy === "function" &&
            typeof stream.once === "function" &&
            typeof stream.on === "function" &&
            typeof stream.off === "function"
        );
    }

    static destroyNodeStream(stream, reason) {
        if (
            typeof stream.once !== "function" ||
            typeof stream.on !== "function" ||
            typeof stream.off !== "function"
        ) {
            stream.destroy(reason);
            return Promise.resolve();
        }
        if (stream.closed) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            let destroyError;
            let isSettled = false;
            let waitTimer;
            const cleanup = () => {
                clearTimeout(waitTimer);
                stream.off("close", onClose);
                stream.off("error", onError);
            };
            const settle = () => {
                if (isSettled) {
                    return;
                }
                isSettled = true;
                cleanup();
                destroyError ? reject(destroyError) : resolve();
            };
            const onError = error => {
                destroyError ||= error;
            };
            const onClose = () => settle();
            const waitForClosed = () => {
                if (stream.closed) {
                    waitTimer = setTimeout(settle, 0);
                } else {
                    waitTimer = setTimeout(waitForClosed, 0);
                }
            };

            stream.once("close", onClose);
            stream.on("error", onError);
            try {
                stream.destroy(reason);
                if (stream._readableState?.emitClose === false) {
                    waitForClosed();
                }
            } catch (error) {
                destroyError ||= error;
                settle();
            }
        });
    }

    static asyncSourceFromStream(stream) {
        if (typeof stream?.getReader === "function") {
            const reader = stream.getReader();
            return {
                cancellable: true,
                next: () => reader.read(),
                abort: reason => reader.cancel(reason),
                stop: reason => reader.cancel(reason),
                release: () => reader.releaseLock()
            };
        }

        const iterator = stream?.[Symbol.asyncIterator]?.();
        if (iterator) {
            const hasDestroy = typeof stream.destroy === "function";
            const canObserveClose =
                typeof stream.once === "function" &&
                typeof stream.on === "function" &&
                typeof stream.off === "function";
            return {
                cancellable: hasDestroy && canObserveClose,
                next: () => iterator.next(),
                abort: hasDestroy
                    ? reason => BufferStream.destroyNodeStream(stream, reason)
                    : reason => iterator.return?.(reason),
                stop: hasDestroy
                    ? () => BufferStream.destroyNodeStream(stream)
                    : () => iterator.return?.(),
                onError:
                    typeof stream.on === "function" &&
                    typeof stream.off === "function"
                        ? handler => {
                              stream.on("error", handler);
                              return () => stream.off("error", handler);
                          }
                        : undefined,
                isExpectedStopError: hasDestroy
                    ? error =>
                          error?.name === "AbortError" ||
                          error?.code === "ABORT_ERR" ||
                          error?.code === "ERR_STREAM_PREMATURE_CLOSE" ||
                          error?.message === "Premature close"
                    : undefined
            };
        }

        throw new TypeError(
            "Async stream must be an async iterable or ReadableStream"
        );
    }

    static arrayBufferFromChunk(chunk) {
        if (chunk instanceof ArrayBuffer) {
            return chunk;
        }
        if (ArrayBuffer.isView(chunk)) {
            return chunk.buffer.slice(
                chunk.byteOffset,
                chunk.byteOffset + chunk.byteLength
            );
        }
        throw new TypeError("Async stream chunks must be ArrayBuffer views");
    }
    async waitForReadAhead(readAheadHighWaterMark, state) {
        if (typeof readAheadHighWaterMark !== "number") {
            return;
        }

        while (
            !state.stopped &&
            this.isPastReadAheadLimit(readAheadHighWaterMark)
        ) {
            await new Promise(resolve => {
                this.readAheadListeners.push(resolve);
            });
        }
    }

    isPastReadAheadLimit(readAheadHighWaterMark) {
        const limit = this.readAheadLimit(readAheadHighWaterMark);
        return limit === 0 ? this.available > 0 : this.available >= limit;
    }

    readAheadLimit(readAheadHighWaterMark) {
        return Math.max(0, readAheadHighWaterMark, this.requestedAvailable);
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

    notifyReadAheadListeners() {
        if (this.readAheadListeners.length === 0) {
            return;
        }
        const existingListeners = [...this.readAheadListeners];
        this.readAheadListeners.splice(0, this.readAheadListeners.length);
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
        this.increment(length);
        newBuf.setComplete();

        return newBuf;
    }

    reset() {
        this.increment(-this.offset);
        return this;
    }

    end() {
        return this.isComplete && this.offset >= this.end;
    }

    toEnd() {
        this.increment(this.view.byteLength - this.offset);
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
        this.decoder = new TextDecoder("latin1");

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
        this.increment(this.startOffset - this.offset);
        return this;
    }

    end() {
        return this.isComplete && this.offset >= this.endOffset;
    }

    toEnd() {
        this.increment(this.endOffset - this.offset);
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
