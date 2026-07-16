import { ReadBufferStream, WriteBufferStream } from "../src/BufferStream";
import { Readable } from "stream";
import { ReadableStream } from "stream/web";

const size = 128;
const buffer = new ArrayBuffer(size);
const dataView = new DataView(buffer);
for (let i = 0; i < size; i++) {
    dataView.setUint8(i, i % 256);
}

function createCountingAsyncSource(chunks) {
    let index = 0;
    let nextCalls = 0;
    return {
        source: {
            [Symbol.asyncIterator]() {
                return {
                    next() {
                        nextCalls++;
                        if (index >= chunks.length) {
                            return Promise.resolve({ done: true });
                        }
                        return Promise.resolve({
                            done: false,
                            value: chunks[index++]
                        });
                    }
                };
            }
        },
        get nextCalls() {
            return nextCalls;
        }
    };
}

describe("ReadBufferStream Tests", () => {
    it("reads single buffer", () => {
        const stream = new ReadBufferStream(buffer, true);
        expect(stream).toBeDefined();
        const view = new DataView(stream.getBuffer(0, size));
        expect(view.getUint8(1)).toBe(1);
        expect(view.getUint16(0)).toBe(1);
        expect(view.getUint32(0)).toBe(66051);
    });

    describe("multi-buffer", () => {
        it("slices multi buffer", () => {
            const stream = new ReadBufferStream(buffer, true);
            stream.addBuffer(buffer);
            expect(stream.size).toBe(size * 2);
            const view = new DataView(stream.getBuffer(size - 4, size + 4));
            expect(view.getUint8(3)).toBe(127);
            expect(view.getUint8(4)).toBe(0);
            expect(view.getUint8(5)).toBe(1);
            expect(view.getUint16(5)).toBe(258);
            expect(view.getUint32(3)).toBe(2130706690);
        });

        it("gets multi buffer", () => {
            const stream = new ReadBufferStream(buffer, true);
            stream.addBuffer(buffer);
            expect(stream.size).toBe(size * 2);
            stream.increment(size - 1);
            expect(stream.readUint8()).toBe(127);
            expect(stream.readUint8()).toBe(0);
            expect(stream.readUint8()).toBe(1);
            stream.reset();
            stream.increment(size + 1);
            expect(stream.readUint16()).toBe(513);
            stream.reset();
            stream.increment(size - 1);
            expect(stream.readUint32(size - 1)).toBe(33620095);
        });
    });

    describe("substream", () => {
        it("gets range of buffer", () => {
            const stream = new ReadBufferStream(buffer, false, {
                start: 32,
                stop: 64
            });
            expect(stream.available).toBe(32);
            expect(stream.startOffset).toBe(32);
            expect(stream.endOffset).toBe(64);
            const buf = stream.slice();
            expect(buf.byteLength).toBe(32);
            const dv = new DataView(buf);
            expect(dv.getUint8(0)).toBe(32);
        });

        it("creates subranges on buffer", () => {
            const stream = new ReadBufferStream(buffer, false, {
                start: 32,
                stop: 64
            });
            const subStream = new ReadBufferStream(
                stream.buffer,
                stream.isLittleEndian,
                { start: stream.offset, stop: stream.size }
            );
            expect(subStream.startOffset).toBe(32);
            expect(subStream.endOffset).toBe(64);
            expect(subStream.size).toBe(64);
        });

        it("creates subranges on stream", () => {
            const stream = new ReadBufferStream(buffer, false, {
                start: 32,
                stop: 64
            });
            // This is the recommended way of creating
            // a sub-stream as it allows either copying
            // or referencing the incoming stream data.
            const subStream = new ReadBufferStream(
                stream,
                stream.isLittleEndian,
                { stop: 48 }
            );
            expect(subStream.available).toBe(16);
            expect(subStream.readUint8()).toBe(32);
        });
    });

    describe("isAvailable", () => {
        it("determines when data is correctly available", () => {
            const stream = new ReadBufferStream(null, false, {
                clearBuffers: true
            });
            expect(stream.isAvailable(0)).toBe(true);
            expect(stream.isAvailable(1)).toBe(false);
            stream.addBuffer(buffer.slice(0, 7));
            expect(stream.isAvailable(7)).toBe(true);
            expect(stream.isAvailable(8)).toBe(false);

            // Read all 4 available/in position
            expect(stream.readUint32()).toBe(dataView.getUint32(0));
            expect(stream.hasData(7, 8)).toBe(false);
            expect(stream.isAvailable(3)).toBe(true);
            expect(stream.isAvailable(4)).toBe(false);

            // Read 3 in one buffer, 1 in next
            stream.addBuffer(buffer.slice(7, 8));
            expect(stream.readUint32()).toBe(dataView.getUint32(4));
            expect(stream.hasData(0, 8)).toBe(true);
            expect(stream.isAvailable(1)).toBe(false);
            expect(stream.isAvailable(0)).toBe(true);

            stream.addBuffer(buffer.slice(8, 10));
            stream.addBuffer(buffer.slice(10, 12));
            expect(stream.readUint32()).toBe(dataView.getUint32(8));

            stream.addBuffer(buffer.slice(12, 13));
            stream.addBuffer(buffer.slice(13, 16));
            expect(stream.readUint32()).toBe(dataView.getUint32(12));

            // Check that buffers can get consumed
            stream.consume();
            expect(stream.hasData(0, 7)).toBe(false);
            expect(stream.hasData(7)).toBe(false);
            expect(stream.hasData(15)).toBe(false);
            expect(stream.hasData(16)).toBe(false);

            // Every byte from a different buffer
            stream.addBuffer(buffer.slice(16, 17));
            expect(stream.hasData(16)).toBe(true);
            stream.addBuffer(buffer.slice(17, 18));
            stream.addBuffer(buffer.slice(18, 19));
            stream.addBuffer(buffer.slice(19, 20));
            expect(stream.readUint32()).toBe(dataView.getUint32(16));
            expect(stream.isAvailable(1)).toBe(false);

            // Now read the rest and check isAvailable
            stream.addBuffer(buffer.slice(20, buffer.byteLength));
            const remaining = buffer.byteLength - 20;
            expect(stream.isAvailable(remaining)).toBe(true);
            expect(stream.isAvailable(remaining + 1)).toBe(false);

            stream.setComplete();
            expect(stream.isAvailable(remaining + 1)).toBe(true);
            expect(stream.isAvailable(remaining, false)).toBe(true);
            expect(stream.isAvailable(remaining + 1, false)).toBe(false);
        });

        it("rechecks pending availability after reset.", async () => {
            const stream = new ReadBufferStream(null, false);
            stream.addBuffer(new ArrayBuffer(4));
            stream.increment(4);
            const available = stream.ensureAvailable(4);

            stream.reset();

            await expect(available).resolves.toBe(true);
        });
    });

    describe("async stream pumping", () => {
        it("rejects unsupported stream sources synchronously.", () => {
            const stream = new ReadBufferStream(null, false);

            expect(() => stream.pumpAsyncStream(new ArrayBuffer(16))).toThrow(
                "Async stream must be an async iterable or ReadableStream"
            );
        });

        it("reads chunks from a ReadableStream source.", async () => {
            const source = new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2]));
                    controller.enqueue(new Uint8Array([3]));
                    controller.close();
                }
            });
            const stream = new ReadBufferStream(null, false);

            await stream.fromAsyncStream(source);
            stream.reset();

            expect(stream.readUint8()).toBe(1);
            expect(stream.readUint8()).toBe(2);
            expect(stream.readUint8()).toBe(3);
            expect(source.locked).toBe(false);
        });

        it("retains low-level support for generic async iterables.", async () => {
            const source = {
                async *[Symbol.asyncIterator]() {
                    yield new Uint8Array([1, 2]);
                    yield new Uint8Array([3]);
                }
            };
            const stream = new ReadBufferStream(null, false);

            const pump = stream.pumpAsyncStream(source);
            expect(pump.cancellable).toBe(false);
            await pump.finished;
            stream.reset();

            expect(stream.readUint8()).toBe(1);
            expect(stream.readUint8()).toBe(2);
            expect(stream.readUint8()).toBe(3);
        });

        it("resumes a bounded pump as bytes are read.", async () => {
            const countedSource = createCountingAsyncSource([
                new Uint8Array([1, 2]),
                new Uint8Array([3, 4])
            ]);
            const stream = new ReadBufferStream(null, false);
            const pump = stream.pumpAsyncStream(countedSource.source, {
                readAheadHighWaterMark: 2
            });

            await stream.ensureAvailable(2);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(countedSource.nextCalls).toBe(1);
            expect(stream.readUint8()).toBe(1);
            expect(stream.readUint8()).toBe(2);
            await stream.ensureAvailable(2);
            expect(countedSource.nextCalls).toBe(2);
            expect(stream.readUint8()).toBe(3);
            expect(stream.readUint8()).toBe(4);
            await pump.finished;

            expect(stream.isComplete).toBe(true);
            expect(countedSource.nextCalls).toBe(3);
        });

        it("resumes a bounded pump after bulk cursor movement.", async () => {
            const countedSource = createCountingAsyncSource([
                new Uint8Array([1, 2, 3, 4]),
                new Uint8Array([5, 6])
            ]);
            const stream = new ReadBufferStream(null, true);
            const pump = stream.pumpAsyncStream(countedSource.source, {
                readAheadHighWaterMark: 4
            });

            await stream.ensureAvailable(4);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(countedSource.nextCalls).toBe(1);
            const values = stream.readUint16Array(4);
            expect(Array.from(values)).toEqual([513, 1027]);
            await stream.ensureAvailable(2);
            expect(countedSource.nextCalls).toBe(2);
            stream.toEnd();
            await pump.finished;

            expect(stream.isComplete).toBe(true);
            expect(countedSource.nextCalls).toBe(3);
        });

        it("resumes a bounded pump after concat advances the cursor.", async () => {
            const countedSource = createCountingAsyncSource([
                new Uint8Array([1, 2, 3, 4]),
                new Uint8Array([5, 6])
            ]);
            const stream = new WriteBufferStream(4, false);
            const consumed = new WriteBufferStream(4, false);
            consumed.writeUint8Repeat(0, 4);
            consumed.reset();
            const pump = stream.pumpAsyncStream(countedSource.source, {
                readAheadHighWaterMark: 4
            });

            await stream.ensureAvailable(4);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(countedSource.nextCalls).toBe(1);

            stream.concat(consumed);
            await stream.ensureAvailable(2);

            expect(countedSource.nextCalls).toBe(2);
            pump.stop();
            await pump.finished;
        });

        it("cancels a source error while the pump is waiting on read-ahead.", async () => {
            const sourceError = new Error("source failed");
            let hasRead = false;
            const source = new Readable({
                read() {
                    if (!hasRead) {
                        hasRead = true;
                        this.push(new Uint8Array([1, 2]));
                    }
                }
            });
            const stream = new ReadBufferStream(null, false);
            const pump = stream.pumpAsyncStream(source, {
                readAheadHighWaterMark: 2
            });

            await stream.ensureAvailable(2);
            source.emit("error", sourceError);

            await expect(pump.failure).rejects.toBe(sourceError);
            await expect(pump.finished).rejects.toBe(sourceError);
        });

        it("applies the read-ahead high-water mark between source chunks.", async () => {
            const countedSource = createCountingAsyncSource([
                new Uint8Array(8),
                new Uint8Array(1)
            ]);
            const stream = new ReadBufferStream(null, false);
            const pump = stream.pumpAsyncStream(countedSource.source, {
                readAheadHighWaterMark: 2
            });

            await stream.ensureAvailable(1);
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(stream.size).toBe(8);
            expect(countedSource.nextCalls).toBe(1);

            pump.stop();
            await pump.finished;
        });

        it("cancels a Web source when chunk processing fails.", async () => {
            let wasCancelled = false;
            const source = new ReadableStream({
                start(controller) {
                    controller.enqueue("invalid chunk");
                },
                cancel() {
                    wasCancelled = true;
                }
            });
            const stream = new ReadBufferStream(null, false);
            const pump = stream.pumpAsyncStream(source);

            await expect(pump.finished).rejects.toThrow(
                "Async stream chunks must be ArrayBuffer views"
            );
            expect(wasCancelled).toBe(true);
            expect(source.locked).toBe(false);
        });

        it("normalizes reasonless source rejections.", async () => {
            const source = {
                [Symbol.asyncIterator]() {
                    return {
                        next() {
                            return Promise.reject();
                        }
                    };
                }
            };
            const stream = new ReadBufferStream(null, false);
            const pump = stream.pumpAsyncStream(source);

            await expect(pump.failure).rejects.toThrow("Async source failed");
            await expect(pump.finished).rejects.toThrow("Async source failed");
        });

        it("cancels a ReadableStream source when stopped.", async () => {
            let receivedStopReason;
            let resolveCancel;
            let isFinished = false;
            const source = new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                },
                cancel(reason) {
                    receivedStopReason = reason;
                    return new Promise(resolve => {
                        resolveCancel = resolve;
                    });
                }
            });
            const stream = new ReadBufferStream(null, false);
            const pump = stream.pumpAsyncStream(source, {
                readAheadHighWaterMark: 1
            });

            await stream.ensureAvailable(1);
            pump.stop();
            const finished = pump.finished.then(() => {
                isFinished = true;
            });
            await Promise.resolve();

            expect(isFinished).toBe(false);

            resolveCancel();
            await finished;

            expect(receivedStopReason).toBeInstanceOf(Error);
            expect(pump.aborted).toBe(false);
            expect(pump.stopped).toBe(true);
            expect(stream.isComplete).toBe(true);
            expect(source.locked).toBe(false);
        });

        it("rejects when aborted by an external error.", async () => {
            const source = new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                }
            });
            const stream = new ReadBufferStream(null, false);
            const pump = stream.pumpAsyncStream(source, {
                readAheadHighWaterMark: 1
            });
            const externalError = new Error("storage failed");

            await stream.ensureAvailable(1);
            pump.abort(externalError);

            await expect(pump.finished).rejects.toBe(externalError);
            expect(pump.aborted).toBe(true);
        });
    });
});
