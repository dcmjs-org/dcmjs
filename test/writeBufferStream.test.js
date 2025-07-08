import "regenerator-runtime/runtime";

import { WriteBufferStream } from "../src/BufferStream";

describe("WriteBufferStream Tests", () => {
    it("writeUint8", () => {
        const stream = new WriteBufferStream(25, true);
        expect(stream).toBeDefined();
        for (let i = 0; i < 512; i++) {
            stream.writeUint8(i % 256);
        }
        for (let i = 0; i < 512; i++) {
            const expected = i % 256;
            const actual = stream.view.getUint8(i);
            if (expected !== actual) {
                console.error(
                    "Expected and actual differ",
                    i,
                    expected,
                    actual
                );
                stream.view.getUint8(i);
            }
            expect(actual).toBe(expected);
        }
    });

    it("writeUint16", () => {
        const stream = new WriteBufferStream(25, true);
        expect(stream).toBeDefined();
        for (let i = 0; i < 512; i++) {
            stream.writeUint16((i * 511) % 0x10000);
        }
        for (let i = 0; i < 512; i++) {
            expect(stream.view.getUint16(i * 2)).toBe((i * 511) % 0x10000);
        }
    });

    it("writeUint32", () => {
        const stream = new WriteBufferStream(25, true);
        expect(stream).toBeDefined();
        for (let i = 0; i < 512; i++) {
            stream.writeUint32(i * 511);
        }
        expect(stream.view.buffers.length).toBe(Math.ceil((512 * 4) / 25));
        for (let i = 0; i < 512; i++) {
            expect(stream.view.getUint32(i * 4)).toBe(i * 511);
        }
    });

    it("writesLongStrings", () => {
        const stream = new WriteBufferStream(32, true);
        let string = "0";
        for (let i = 1; i < 512; i++) {
            string = string + ", " + i;
        }
        stream.writeAsciiString(string);
        expect(stream.view.buffers.length).toBe(Math.ceil(string.length / 32));
    });
});
