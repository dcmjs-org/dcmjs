import SplitDataView from "../src/SplitDataView";

const MB = 1024 * 1024;

/**
 * Pushes a zero-copy window onto the view: an entry whose chunk is a large
 * shared backing ArrayBuffer but whose logical span (recorded in lengths[])
 * covers only [start, end).  This is the state the zero-copy addBuffer
 * transfer path produces when several windows share one source buffer, and
 * it is the state getBufferMemoryInfo must account by span, not by backing
 * allocation (review finding 27).
 */
function addWindow(view, backing, start, end) {
    const length = end - start;
    view.buffers.push(backing);
    view.views.push(new DataView(backing, start, length));
    view.offsets.push(view.byteLength);
    view.lengths.push(length);
    view.size += length;
    view.byteLength += length;
}

describe("SplitDataView.getBufferMemoryInfo", () => {
    it("reports view spans, not the backing ArrayBuffer, for shared-buffer windows", () => {
        const view = new SplitDataView();
        const backing = new ArrayBuffer(8 * MB);

        // Two 2 MB windows over the same 8 MB backing buffer.
        addWindow(view, backing, 0, 2 * MB);
        addWindow(view, backing, 2 * MB, 4 * MB);

        const info = view.getBufferMemoryInfo(0);
        expect(info.bufferCount).toBe(2);
        // Each window contributes its own span (2 MB), never the whole
        // 8 MB backing allocation — and never the backing counted twice.
        expect(info.totalSize).toBe(4 * MB);
    });

    it("clamps bytesBeforeOffset to the consume offset over shared-buffer windows", () => {
        const view = new SplitDataView();
        const backing = new ArrayBuffer(8 * MB);
        addWindow(view, backing, 0, 2 * MB);
        addWindow(view, backing, 2 * MB, 4 * MB);

        // Consume offset lands 1 MB into the second window.
        const consumeOffset = 3 * MB;
        const info = view.getBufferMemoryInfo(consumeOffset);

        // First window fully consumed (2 MB) plus 1 MB of the second.
        expect(info.buffersBeforeOffset).toBe(1);
        expect(info.bytesBeforeOffset).toBe(3 * MB);
        // bytesBeforeOffset above the consume offset is impossible.
        expect(info.bytesBeforeOffset).toBeLessThanOrEqual(consumeOffset);
    });

    it("still counts exact ArrayBuffer chunks at full size", () => {
        const view = new SplitDataView();
        view.addBuffer(new ArrayBuffer(1000));
        view.addBuffer(new ArrayBuffer(500));

        const info = view.getBufferMemoryInfo(1200);
        expect(info.bufferCount).toBe(2);
        expect(info.totalSize).toBe(1500);
        expect(info.buffersBeforeOffset).toBe(1);
        expect(info.bytesBeforeOffset).toBe(1200);
    });

    it("reports zero bytesBeforeOffset when nothing has been consumed", () => {
        const view = new SplitDataView();
        view.addBuffer(new ArrayBuffer(1000));

        // Default consumeOffset is -1 (nothing consumed yet).
        const info = view.getBufferMemoryInfo();
        expect(info.totalSize).toBe(1000);
        expect(info.bytesBeforeOffset).toBe(0);
    });
});

describe("SplitDataView.findStart", () => {
    /** The linear scan findStart used before #629, as a reference. */
    function scan(view, start) {
        for (let index = 0; index < view.buffers.length; index++) {
            if (
                start >= view.offsets[index] &&
                start < view.offsets[index] + view.lengths[index]
            ) {
                return index;
            }
        }
    }

    it("finds the same buffer as a linear scan, at every boundary", () => {
        const view = new SplitDataView({ defaultSize: 16 });
        view.checkSize(64);
        for (const length of [1, 7, 33, 2, 100]) {
            view.addBuffer(new ArrayBuffer(length));
        }
        view.checkSize(view.byteLength + 40);

        for (let start = -2; start <= view.byteLength + 2; start++) {
            expect(view.findStart(start)).toBe(scan(view, start));
        }
    });

    it("refuses a start that is out of range or not a number", () => {
        const view = new SplitDataView({ defaultSize: 16 });
        expect(view.findStart(0)).toBeUndefined();
        view.checkSize(48);
        expect(view.findStart(-1)).toBeUndefined();
        expect(view.findStart(48)).toBeUndefined();
        expect(view.findStart(NaN)).toBeUndefined();
        expect(view.findStart()).toBe(0);
    });

    it("stays fast with many buffers (#629)", () => {
        // 256-byte chunks, as Tag.write uses for each value.  A linear scan
        // takes tens of seconds here; a binary search, milliseconds.
        const count = 100000;
        const view = new SplitDataView({ defaultSize: 256 });
        view.checkSize(count * 256);
        let misses = 0;
        const t0 = performance.now();
        for (let i = 0; i < count; i++) {
            const start = (count - 1) * 256 + (i % 256);
            if (view.findStart(start) !== count - 1) {
                misses++;
            }
        }
        const elapsed = performance.now() - t0;
        expect(misses).toBe(0);
        expect(elapsed).toBeLessThan(2000);
    });
});
