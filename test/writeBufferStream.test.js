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
        // Geometric growth: capacity at least doubles per allocation, so the
        // chunk count stays logarithmic in the data size instead of linear.
        expect(stream.view.buffers.length).toBe(
            Math.ceil(Math.log2((512 * 4) / 25)) + 1
        );
        expect(stream.view.byteLength).toBeGreaterThanOrEqual(512 * 4);
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
        // Geometric growth keeps the chunk count logarithmic in data size.
        expect(stream.view.buffers.length).toBe(
            Math.ceil(Math.log2((512 * 8) / 25)) + 1
        );
        expect(stream.view.byteLength).toBeGreaterThanOrEqual(512 * 8);
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
        // The whole string is reserved in one checkSize call, so geometric
        // growth allocates it as a single chunk.
        expect(stream.view.buffers.length).toBe(1);
        expect(stream.view.byteLength).toBeGreaterThanOrEqual(string.length);
    });

    describe("writeRawBytes", () => {
        // below the 64k zero-copy threshold: bytes are copied in place
        it("copies small spans into the stream", () => {
            const stream = new WriteBufferStream(16, true);
            stream.writeAsciiString("HEAD");
            const source = new Uint8Array(64);
            for (let i = 0; i < source.length; i++) {
                source[i] = i + 1;
            }
            expect(stream.writeRawBytes(source.subarray(8, 40))).toBe(32);
            stream.writeAsciiString("TAIL");

            const result = new Uint8Array(stream.getBuffer());
            expect(result.length).toBe(4 + 32 + 4);
            expect(String.fromCharCode(...result.subarray(0, 4))).toBe("HEAD");
            expect(Array.from(result.subarray(4, 36))).toEqual(
                Array.from(source.subarray(8, 40))
            );
            expect(String.fromCharCode(...result.subarray(36))).toBe("TAIL");
            // copied, not aliased
            expect(stream.view.zeroCopyChunks.size).toBe(0);
        });

        it("appends large spans zero-copy and keeps later writes and backpatches correct", () => {
            const stream = new WriteBufferStream(256, true);
            stream.writeAsciiString("HEAD");
            const lengthOffset = stream.offset;
            stream.writeUint32(0); // reserved, backpatched below

            const source = new Uint8Array(80 * 1024 + 16);
            for (let i = 0; i < source.length; i++) {
                source[i] = (i * 7) & 0xff;
            }
            const window = source.subarray(16, 16 + 80 * 1024);
            expect(stream.writeRawBytes(window)).toBe(window.byteLength);
            stream.writeAsciiString("TAIL");
            stream.writeUint32At(lengthOffset, window.byteLength);

            // the window was aliased (zero-copy), not copied
            expect(stream.view.zeroCopyChunks.size).toBe(1);
            expect(stream.view.buffers).toContain(source.buffer);

            const result = new Uint8Array(stream.getBuffer());
            expect(result.length).toBe(8 + window.byteLength + 4);
            expect(String.fromCharCode(...result.subarray(0, 4))).toBe("HEAD");
            expect(new DataView(result.buffer).getUint32(4, true)).toBe(
                window.byteLength
            );
            expect(
                Buffer.from(result.subarray(8, 8 + window.byteLength)).equals(
                    Buffer.from(window)
                )
            ).toBe(true);
            expect(
                String.fromCharCode(...result.subarray(8 + window.byteLength))
            ).toBe("TAIL");
            // the source bytes were never mutated
            expect(source[16]).toBe((16 * 7) & 0xff);
        });

        it("refuses to write into a zero-copy window", () => {
            const stream = new WriteBufferStream(64, true);
            stream.writeAsciiString("HEAD");
            const window = new Uint8Array(80 * 1024).fill(0x42);
            stream.writeRawBytes(window);
            expect(() => stream.view.writeBuffer(new Uint8Array(4), 6)).toThrow(
                "read-only zero-copy chunk"
            );
            // window bytes intact
            expect(window[0]).toBe(0x42);
        });

        it("concat copies window bytes out of a zero-copy stream", () => {
            const inner = new WriteBufferStream(64, true);
            inner.writeAsciiString("AB");
            const window = new Uint8Array(70000);
            for (let i = 0; i < window.length; i++) {
                window[i] = (i * 3) & 0xff;
            }
            inner.writeRawBytes(window);
            inner.writeAsciiString("CD");

            const outer = new WriteBufferStream(64, true);
            outer.writeAsciiString("X");
            outer.concat(inner);

            const result = new Uint8Array(outer.getBuffer());
            expect(result.length).toBe(1 + 2 + window.length + 2);
            expect(String.fromCharCode(...result.subarray(0, 3))).toBe("XAB");
            expect(
                Buffer.from(result.subarray(3, 3 + window.length)).equals(
                    Buffer.from(window)
                )
            ).toBe(true);
            expect(
                String.fromCharCode(...result.subarray(3 + window.length))
            ).toBe("CD");
            // the concat target owns plain copies only
            expect(outer.view.buffers).not.toContain(window.buffer);
        });
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
});
