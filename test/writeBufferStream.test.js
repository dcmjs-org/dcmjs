import { ReadBufferStream, WriteBufferStream } from "../src/BufferStream";

describe("WriteBufferStream Tests", () => {
    it("writeUint8", () => {
        const stream = new WriteBufferStream({
            defaultSize: 25,
            littleEndian: true
        });
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
        const stream = new WriteBufferStream({
            defaultSize: 25,
            littleEndian: true
        });
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
        const stream = new WriteBufferStream({
            defaultSize: 25,
            littleEndian: true
        });
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
        const stream = new WriteBufferStream({ defaultSize: 32 });
        let string = "0";
        for (let i = 1; i < 512; i++) {
            string = string + ", " + i;
        }
        stream.writeAsciiString(string);
        expect(stream.view.buffers.length).toBe(Math.ceil(string.length / 32));
    });

    describe("readWorksAfterWrite", () => {
        const out = new WriteBufferStream({ defaultSize: 3 });
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
        out.concat(
            new ReadBufferStream(out, {
                start: 0,
                littleEndian: out.isLittleEndian
            })
        );
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
            const stream = new ReadBufferStream(out, {
                start: 0,
                littleEndian: out.isLittleEndian
            });
            expect(stream.size).toBe(out.size);
            checkValues(stream);
            // Second copy identical
            checkValues(stream);
            expect(stream.end()).toBe(true);
        });

        it("Should clone with buffer", () => {
            const stream = new ReadBufferStream(out.buffer, {
                stop: out.size,
                littleEndian: out.isLittleEndian
            });
            expect(stream.size).toBe(out.size);
            checkValues(stream);
            // Second copy identical
            checkValues(stream);
            expect(stream.end()).toBe(true);
        });

        it("Should clone with slice", () => {
            const stream = new ReadBufferStream(out.slice(0, out.size), {
                littleEndian: out.isLittleEndian
            });
            expect(stream.size).toBe(out.size);
            checkValues(stream);
            // Second copy identical
            checkValues(stream);
            expect(stream.end()).toBe(true);
        });
    });
});
