import { ReadBufferStream, WriteBufferStream } from "@dcmjs-org/core";

describe("stream constructors (REG-U-16, REG-U-17)", () => {
    it("API: the legacy 3-argument ReadBufferStream keeps start and stop", () => {
        const buffer = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7).buffer;
        const stream = new ReadBufferStream(buffer, true, {
            start: 2,
            stop: 6
        });
        expect(stream.offset).toBe(2);
        expect(stream.endOffset).toBe(6);
        expect(stream.readUint16()).toBe(0x0302);
    });

    it("API: legacy WriteBufferStream(n, false) is big endian; the new form defaults to little endian", () => {
        const big = new WriteBufferStream(16, false);
        big.writeUint16(0x0102);
        expect([...new Uint8Array(big.getBuffer())]).toEqual([1, 2]);

        const little = new WriteBufferStream();
        little.writeUint16(0x0102);
        expect([...new Uint8Array(little.getBuffer())]).toEqual([2, 1]);
    });
});
