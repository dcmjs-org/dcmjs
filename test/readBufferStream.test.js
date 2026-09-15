import { ReadBufferStream, WriteBufferStream } from "../src/BufferStream";

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

    describe("readUint16Array", () => {
        const values = [0x0102, 0xfffe, 0x0000, 0xabcd, 0x1234, 0xffff];

        const encode = littleEndian => {
            const encoded = new ArrayBuffer(values.length * 2);
            const dv = new DataView(encoded);
            values.forEach((v, i) => dv.setUint16(i * 2, v, littleEndian));
            return encoded;
        };

        it.each([
            ["little endian", true],
            ["big endian", false]
        ])(
            "reads a known uint16 array in %s without shifting elements",
            (_name, littleEndian) => {
                const stream = new ReadBufferStream(
                    encode(littleEndian),
                    littleEndian
                );
                const arr = stream.readUint16Array(values.length * 2);
                expect(arr).toBeInstanceOf(Uint16Array);
                expect(arr.length).toBe(values.length);
                // Pins the off-by-one: first element must be the first
                // encoded value (not 0) and the last element must not be
                // dropped.
                expect(Array.from(arr)).toEqual(values);
                expect(stream.offset).toBe(values.length * 2);
            }
        );

        it.each([
            ["little endian", true],
            ["big endian", false]
        ])("reads across chunk boundaries in %s", (_name, littleEndian) => {
            const encoded = encode(littleEndian);
            const stream = new ReadBufferStream(null, littleEndian, {});
            // Split mid-value so one uint16 straddles two chunks.
            stream.addBuffer(encoded.slice(0, 5));
            stream.addBuffer(encoded.slice(5));
            stream.setComplete();
            const arr = stream.readUint16Array(values.length * 2);
            expect(Array.from(arr)).toEqual(values);
        });
    });

    describe("shared default encoder/decoder", () => {
        it("shares the default latin1 decoder between read streams", () => {
            const a = new ReadBufferStream(buffer, true);
            const b = new ReadBufferStream(buffer, true);
            expect(a.decoder).toBe(b.decoder);
            // "latin1" is a WHATWG label of windows-1252; compare against a
            // fresh latin1 decoder rather than hard-coding the canonical name.
            expect(a.decoder.encoding).toBe(new TextDecoder("latin1").encoding);
        });

        it("setDecoder installs a per-stream decoder without mutating the shared default", () => {
            const a = new ReadBufferStream(buffer, true);
            const b = new ReadBufferStream(buffer, true);
            const custom = new TextDecoder("utf-8");
            a.setDecoder(custom);
            expect(a.decoder).toBe(custom);
            expect(b.decoder).not.toBe(custom);
            expect(b.decoder.encoding).toBe(new TextDecoder("latin1").encoding);
            // Streams created after the override still get the default.
            const c = new ReadBufferStream(buffer, true);
            expect(c.decoder).toBe(b.decoder);
        });

        it("decodes latin1 by default", () => {
            const bytes = new Uint8Array([0x48, 0x69, 0xe9]).buffer;
            const stream = new ReadBufferStream(bytes, true);
            expect(stream.readEncodedString(3)).toBe("Hié");
        });

        it("shares the encoder between write streams and still encodes UTF-8", () => {
            const w1 = new WriteBufferStream(32, true);
            const w2 = new WriteBufferStream(32, true);
            expect(w1.encoder).toBe(w2.encoder);
            w1.writeUTF8String("café");
            const out = new Uint8Array(w1.getBuffer(0, w1.size));
            expect(Array.from(out)).toEqual([0x63, 0x61, 0x66, 0xc3, 0xa9]);
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
