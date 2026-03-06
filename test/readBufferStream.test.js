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
