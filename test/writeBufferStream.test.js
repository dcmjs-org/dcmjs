import { ReadBufferStream, WriteBufferStream } from "../src/BufferStream";

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
            expect(stream.view.getUint16(i * 2, stream.isLittleEndian)).toBe(
                (i * 511) % 0x10000
            );
        }
    });

    it("writeUint32", () => {
        const stream = new WriteBufferStream(25, true);
        expect(stream).toBeDefined();
        const expected = [];
        for (let i = 0; i < 512; i++) {
            expected[i] = i * 511;
            stream.writeUint32(expected[i]);
        }
        expect(stream.view.buffers.length).toBe(Math.ceil((512 * 4) / 25));
        for (let i = 0; i < 512; i++) {
            const actual = stream.view.getUint32(i * 4, stream.isLittleEndian);
            expect(actual).toBe(expected[i]);
        }
    });

    it("writeBigUint64", () => {
        const stream = new WriteBufferStream(25, true);
        expect(stream).toBeDefined();
        const expected = [];
        for (let i = 0; i < 512; i++) {
            expected[i] = BigInt(i) * BigInt("0x7fffffffffffff"); // 0x7fffffffffffff = (2^64 - 1) / 512
            stream.writeBigUint64(expected[i]);
        }
        expect(stream.view.buffers.length).toBe(Math.ceil((512 * 8) / 25));
        for (let i = 0; i < 512; i++) {
            const actual = stream.view.getBigUint64(
                i * 8,
                stream.isLittleEndian
            );
            expect(actual).toBe(expected[i]);
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

    describe("readWorksAfterWrite", () => {
        const out = new WriteBufferStream(3, true);
        const testStr = "Hello World";
        // 64 bits
        out.writeUint8Repeat(1, 128);
        out.writeAsciiString("DICM");
        out.writeDouble(Math.PI);
        out.writeAsciiString(testStr);
        out.writeFloat(Math.PI);
        out.writeUTF8String(testStr);
        out.writeInt16(-123);
        out.writeInt32(-234);
        out.writeInt8(-25);
        out.writeBigUint64(BigInt(123456789));
        out.writeUint32(123);
        out.writeUint16(234);
        out.writeUint8(25);
        const firstSize = out.size;
        out.concat(new ReadBufferStream(out, out.isLittleEndian, { start: 0 }));
        expect(out.size).toBe(firstSize * 2);

        const checkValues = stream => {
            expect(stream.readUint8Array(128)[5]).toBe(1);
            expect(stream.readAsciiString(4)).toBe("DICM");
            expect(stream.readDouble()).toBeCloseTo(Math.PI);
            expect(stream.readAsciiString(testStr.length)).toBe(testStr);
            expect(stream.readFloat()).toBeCloseTo(Math.PI);
            expect(stream.readAsciiString(testStr.length)).toBe(testStr);
            expect(stream.readInt16()).toBe(-123);
            expect(stream.readInt32()).toBe(-234);
            expect(stream.readInt8()).toBe(-25);
            expect(stream.readBigUint64()).toBe(BigInt(123456789));
            expect(stream.readUint32()).toBe(123);
            expect(stream.readUint16()).toBe(234);
            expect(stream.readUint8()).toBe(25);
        };

        it("Should clone with getBuffer", () => {
            const stream = new ReadBufferStream(
                out.getBuffer(),
                out.isLittleEndian
            );
            expect(stream.size).toBe(out.size);
            checkValues(stream);
            // Second copy identical
            checkValues(stream);
            expect(stream.end()).toBe(true);
        });

        it("Should clone with stream", () => {
            const stream = new ReadBufferStream(out, out.isLittleEndian, {
                start: 0
            });
            expect(stream.size).toBe(out.size);
            checkValues(stream);
            // Second copy identical
            checkValues(stream);
            expect(stream.end()).toBe(true);
        });

        it("Should clone with buffer", () => {
            const stream = new ReadBufferStream(
                out.buffer,
                out.isLittleEndian,
                {
                    stop: out.size
                }
            );
            expect(stream.size).toBe(out.size);
            checkValues(stream);
            // Second copy identical
            checkValues(stream);
            expect(stream.end()).toBe(true);
        });

        it("Should clone with slice", () => {
            const stream = new ReadBufferStream(
                out.slice(0, out.size),
                out.isLittleEndian
            );
            expect(stream.size).toBe(out.size);
            checkValues(stream);
            // Second copy identical
            checkValues(stream);
            expect(stream.end()).toBe(true);
        });
    });

    // Review finding 28: concat copies the range [startOffset, size) of
    // the source, but used to advance the write position by the full
    // stream.size. For a source whose startOffset is above 0 that left
    // startOffset uninitialized bytes at the tail of the destination.
    describe("concat", () => {
        it("advances the write position by only the copied bytes", () => {
            const out = new WriteBufferStream(32, true);
            out.writeAsciiString("AB");

            const srcBytes = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
            const src = new ReadBufferStream(srcBytes, true, {
                start: 2,
                stop: 6
            });
            expect(src.startOffset).toBe(2);
            expect(src.size).toBe(6);

            out.concat(src);

            // 2 bytes written + 4 bytes copied — not + the source's
            // whole 6-byte size.
            expect(out.size).toBe(6);
            expect(out.offset).toBe(6);
            const bytes = new Uint8Array(out.getBuffer(0, out.size));
            expect(Array.from(bytes)).toEqual([65, 66, 3, 4, 5, 6]);
        });

        it("keeps the full-stream concat behaviour unchanged", () => {
            const out = new WriteBufferStream(32, true);
            out.writeAsciiString("CD");

            const srcBytes = new Uint8Array([7, 8, 9]).buffer;
            const src = new ReadBufferStream(srcBytes, true);
            expect(src.startOffset).toBe(0);

            out.concat(src);

            expect(out.size).toBe(5);
            const bytes = new Uint8Array(out.getBuffer(0, out.size));
            expect(Array.from(bytes)).toEqual([67, 68, 7, 8, 9]);
        });
    });
});
