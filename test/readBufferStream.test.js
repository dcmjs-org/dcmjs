import "regenerator-runtime/runtime";

import { ReadBufferStream } from "../src/BufferStream";

const size = 128;
const buffer = new ArrayBuffer(size);
const createView = new DataView(buffer);
for (let i = 0; i < size; i++) {
    createView.setUint8(i, i % 256);
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
            expect(stream.readUint16()).toBe(258);
            stream.reset();
            stream.increment(size - 1);
            expect(stream.readUint32(size - 1)).toBe(2130706690);
        });
    });
});
