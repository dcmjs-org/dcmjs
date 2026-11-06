import { ReadBufferStream } from "../src/BufferStream";

const size = 128;
const buffer = new ArrayBuffer(size);
const dataView = new DataView(buffer);
for (let i = 0; i < size; i++) {
    dataView.setUint8(i, i % 256);
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

        // A small Node.js Buffer is such a view of a shared pool
        it("adds only the bytes of a view of a larger ArrayBuffer", () => {
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(new Uint8Array(buffer, 16, 8));
            stream.addBuffer(new DataView(buffer, 100, 4));
            stream.setComplete();
            expect(stream.size).toBe(12);
            expect(Array.from(new Uint8Array(stream.getBuffer(0, 12)))).toEqual(
                [16, 17, 18, 19, 20, 21, 22, 23, 100, 101, 102, 103]
            );
        });

        it("reads only the bytes of a view given to the constructor", () => {
            const stream = new ReadBufferStream(new Uint8Array(buffer, 16, 8));
            expect(stream.size).toBe(8);
            expect(stream.readUint8()).toBe(16);
        });

        it("clamps start and end to the view", () => {
            const stream = new ReadBufferStream(null, true);
            // end past the view adds only the view bytes
            stream.addBuffer(new Uint8Array(buffer, 16, 8), { end: 64 });
            // a negative start reads no bytes before the view
            stream.addBuffer(new Uint8Array(buffer, 32, 4), { start: -4 });
            stream.setComplete();
            expect(stream.size).toBe(12);
            expect(Array.from(new Uint8Array(stream.getBuffer(0, 12)))).toEqual(
                [16, 17, 18, 19, 20, 21, 22, 23, 32, 33, 34, 35]
            );
        });

        it("adds nothing for an explicit start 0, end 0", () => {
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(new Uint8Array(buffer, 16, 8), {
                start: 0,
                end: 0
            });
            stream.addBuffer(buffer.slice(0), { start: 0, end: 0 });
            stream.setComplete();
            expect(stream.size).toBe(0);
        });

        it("copies only the view bytes for an explicit transfer", () => {
            // a small Node.js Buffer is a view of a large shared pool
            const pooled = Buffer.from([1, 2, 3]);
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(pooled, { transfer: true });
            stream.setComplete();
            expect(stream.size).toBe(3);
            expect(Array.from(new Uint8Array(stream.getBuffer(0, 3)))).toEqual([
                1, 2, 3
            ]);
            /** the stream holds a copy, not the shared pool */
            expect(stream.view.buffers[0]).not.toBe(pooled.buffer);
        });

        it("copies only the range of an ArrayBuffer for an explicit transfer", () => {
            const own = buffer.slice(0);
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(own, { start: 16, end: 24, transfer: true });
            stream.setComplete();
            expect(stream.size).toBe(8);
            expect(Array.from(new Uint8Array(stream.getBuffer(0, 8)))).toEqual([
                16, 17, 18, 19, 20, 21, 22, 23
            ]);
            /** the partial range is copied, so the stream doesn't hold the source */
            expect(stream.view.buffers[0]).not.toBe(own);
        });

        it("copies a whole view by default, so the caller can reuse it", () => {
            const u8 = new Uint8Array(16);
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(u8);
            u8[0] = 99;
            stream.setComplete();
            expect(stream.readUint8()).toBe(0);
        });

        it("keeps a reference to a plain ArrayBuffer", () => {
            const own = buffer.slice(0);
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(own);
            stream.setComplete();
            expect(stream.view.buffers[0]).toBe(own);
        });

        it("keeps a reference to a whole-buffer view for an explicit transfer", () => {
            const u8 = new Uint8Array(16);
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(u8, { transfer: true });
            stream.setComplete();
            expect(stream.view.buffers[0]).toBe(u8.buffer);
        });

        it("adds nothing for a NaN start or end", () => {
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(new Uint8Array(buffer, 16, 8), { start: NaN });
            stream.addBuffer(buffer.slice(0), { end: NaN });
            stream.setComplete();
            expect(stream.size).toBe(0);
            // no zero-length ghost entry is pushed either
            expect(stream.view.buffers.length).toBe(0);
        });

        it("clamps a negative start of a plain ArrayBuffer to 0", () => {
            const own = buffer.slice(0);
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(own, { start: -4 });
            stream.setComplete();
            expect(stream.size).toBe(size);
            expect(stream.readUint8()).toBe(0);
        });

        it("adds nothing for a negative end", () => {
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(buffer.slice(0), { end: -4 });
            stream.setComplete();
            expect(stream.size).toBe(0);
        });

        it("clamps an end past the buffer and transfers the whole buffer", () => {
            const own = buffer.slice(0);
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(own, { end: size + 64 });
            stream.setComplete();
            expect(stream.size).toBe(size);
            // the clamped range covers the whole buffer, so it is
            // kept by reference like a whole buffer without options
            expect(stream.view.buffers[0]).toBe(own);
        });

        it("copies a whole plain ArrayBuffer for an explicit transfer false", () => {
            const own = buffer.slice(0);
            const stream = new ReadBufferStream(null, true);
            stream.addBuffer(own, { transfer: false });
            stream.setComplete();
            expect(stream.size).toBe(size);
            expect(stream.view.buffers[0]).not.toBe(own);
        });

        it("copies a whole-buffer view given to the constructor", () => {
            const u8 = new Uint8Array(16).fill(7);
            const stream = new ReadBufferStream(u8);
            expect(stream.view.buffers[0]).not.toBe(u8.buffer);
            u8[0] = 99;
            expect(stream.readUint8()).toBe(7);
        });

        it("copies the chunks of an async stream", async () => {
            const ab = buffer.slice(0, 4);
            const u8 = new Uint8Array([9, 9]);
            async function* chunks() {
                yield ab;
                yield u8;
            }
            const stream = new ReadBufferStream(null, true);
            await stream.fromAsyncStream(chunks());
            new Uint8Array(ab)[0] = 77;
            u8[0] = 77;
            expect(stream.size).toBe(6);
            expect(Array.from(new Uint8Array(stream.getBuffer(0, 6)))).toEqual([
                0, 1, 2, 3, 9, 9
            ]);
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
    });
});
