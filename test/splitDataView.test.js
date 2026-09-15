import SplitDataView from "../src/SplitDataView";

/**
 * Builds a multi-chunk SplitDataView plus a contiguous DataView over the
 * same bytes to compare reads against.
 */
function buildChunked(chunkCount, chunkSize) {
    const total = chunkCount * chunkSize;
    const reference = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        reference[i] = (i * 7 + 3) & 0xff;
    }
    const view = new SplitDataView();
    for (let c = 0; c < chunkCount; c++) {
        view.addBuffer(
            reference.buffer.slice(c * chunkSize, (c + 1) * chunkSize)
        );
    }
    return { view, referenceView: new DataView(reference.buffer), total };
}

describe("SplitDataView", () => {
    describe("findStart cached-chunk fast path", () => {
        it("returns correct chunks for sequential forward reads", () => {
            const { view, referenceView, total } = buildChunked(64, 32);
            for (let offset = 0; offset + 2 <= total; offset += 2) {
                expect(view.getUint16(offset, true)).toBe(
                    referenceView.getUint16(offset, true)
                );
            }
        });

        it("returns correct chunks for backward and random reads (cache misses)", () => {
            const { view, referenceView, total } = buildChunked(64, 32);
            // Prime the cache at the last chunk.
            view.getUint8(total - 1);
            for (let offset = total - 4; offset >= 0; offset -= 4) {
                expect(view.getUint32(offset, true)).toBe(
                    referenceView.getUint32(offset, true)
                );
            }
            const probes = [0, total - 4, 33, 1024, 5, total / 2, 17];
            for (const offset of probes) {
                expect(view.getUint32(offset, false)).toBe(
                    referenceView.getUint32(offset, false)
                );
            }
        });

        it("reads values straddling chunk boundaries", () => {
            const { view, referenceView } = buildChunked(8, 8);
            // Each read crosses a chunk boundary.
            for (let chunk = 1; chunk < 8; chunk++) {
                const offset = chunk * 8 - 2;
                expect(view.getUint32(offset, true)).toBe(
                    referenceView.getUint32(offset, true)
                );
            }
        });

        it("findStart returns the same indices as a plain linear scan", () => {
            const { view, total } = buildChunked(16, 16);
            const scan = start => {
                for (let index = 0; index < view.buffers.length; index++) {
                    if (
                        start >= view.offsets[index] &&
                        start < view.offsets[index] + view.lengths[index]
                    ) {
                        return index;
                    }
                }
            };
            const offsets = [0, 1, 15, 16, 17, 100, 255, 128, 31, total - 1];
            for (const offset of offsets) {
                expect(view.findStart(offset)).toBe(scan(offset));
            }
            expect(view.findStart(total)).toBeUndefined();
        });

        it("stays correct when chunks are added after reads", () => {
            const view = new SplitDataView();
            view.addBuffer(new Uint8Array([1, 2, 3, 4]).buffer);
            expect(view.getUint8(3)).toBe(4);
            view.addBuffer(new Uint8Array([5, 6, 7, 8]).buffer);
            expect(view.getUint8(4)).toBe(5);
            expect(view.getUint8(7)).toBe(8);
            expect(view.getUint8(0)).toBe(1);
        });

        it("stays correct after consume nulls earlier chunks", () => {
            const { view, referenceView, total } = buildChunked(8, 16);
            // Prime the cache deep into the stream.
            view.getUint8(total - 1);
            // Consume the first half of the chunks.
            view.consume(64);
            expect(view.hasData(0, 16)).toBe(false);
            // Reads in the remaining region must still resolve correctly.
            for (let offset = 64; offset + 2 <= total; offset += 2) {
                expect(view.getUint16(offset, true)).toBe(
                    referenceView.getUint16(offset, true)
                );
            }
        });

        it("stays correct across truncateTo from a zero-copy window append", () => {
            const view = new SplitDataView({ defaultSize: 16 });
            view.checkSize(16);
            view.writeBuffer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 0);
            view.size = 8;
            // Prime the cache on the writable chunk.
            expect(view.getUint8(7)).toBe(8);
            // Appending a window truncates the writable chunk to 8 bytes.
            const windowBytes = new Uint8Array(100).fill(9);
            view.addZeroCopyWindow(windowBytes, 8);
            expect(view.getUint8(8)).toBe(9);
            expect(view.getUint8(107)).toBe(9);
            expect(view.getUint8(0)).toBe(1);
            expect(view.getUint16(7, false)).toBe((8 << 8) | 9);
        });
    });

    describe("consume — consumeListener contract", () => {
        /**
         * Build a view with three distinct-size chunks so we can verify
         * the listener receives correct per-chunk arguments:
         *   chunk 0: logical bytes [0, 10)
         *   chunk 1: logical bytes [10, 25)
         *   chunk 2: logical bytes [25, 40)
         */
        function buildThreeChunks() {
            const view = new SplitDataView();
            view.addBuffer(new Uint8Array(10).fill(1).buffer); // chunk 0
            view.addBuffer(new Uint8Array(15).fill(2).buffer); // chunk 1
            view.addBuffer(new Uint8Array(15).fill(3).buffer); // chunk 2
            return view;
        }

        it("calls listener once per released chunk with (chunkIndex, logicalOffset, byteLength)", () => {
            const view = buildThreeChunks();
            const calls = [];
            view.consumeListener = (chunkIndex, logicalOffset, byteLength) => {
                calls.push({ chunkIndex, logicalOffset, byteLength });
            };

            // consume(10): consumeOffset=10 >= end of chunk 0 (10) → releases chunk 0
            // consumeOffset=10 < end of chunk 1 (25) → stops
            view.consume(10);
            expect(calls).toHaveLength(1);
            expect(calls[0]).toEqual({
                chunkIndex: 0,
                logicalOffset: 0,
                byteLength: 10
            });

            // consume(30): consumeOffset=30 >= end of chunk 1 (25) → releases chunk 1
            // consumeOffset=30 < end of chunk 2 (40) → stops
            view.consume(30);
            expect(calls).toHaveLength(2);
            expect(calls[1]).toEqual({
                chunkIndex: 1,
                logicalOffset: 10,
                byteLength: 15
            });

            // consume(40): consumeOffset=40 >= end of chunk 2 (40) → releases chunk 2
            view.consume(40);
            expect(calls).toHaveLength(3);
            expect(calls[2]).toEqual({
                chunkIndex: 2,
                logicalOffset: 25,
                byteLength: 15
            });
        });

        it("never passes a negative byteLength to the listener", () => {
            const view = buildThreeChunks();
            const badCalls = [];
            view.consumeListener = (chunkIndex, logicalOffset, byteLength) => {
                if (
                    byteLength < 0 ||
                    chunkIndex < 0 ||
                    logicalOffset < 0
                ) {
                    badCalls.push({ chunkIndex, logicalOffset, byteLength });
                }
            };

            // Release all three chunks in one call.
            view.consume(40);
            expect(badCalls).toHaveLength(0);
        });

        it("is not called for chunks not yet fully consumed", () => {
            const view = new SplitDataView();
            view.addBuffer(new Uint8Array(20).fill(0).buffer); // chunk 0: [0, 20)
            view.addBuffer(new Uint8Array(20).fill(0).buffer); // chunk 1: [20, 40)

            const calls = [];
            view.consumeListener = (...args) => calls.push(args);

            // consuming mid-chunk does NOT release it
            view.consume(19);
            expect(calls).toHaveLength(0);

            // consuming exactly to the end releases it
            view.consume(20);
            expect(calls).toHaveLength(1);
        });
    });
});
