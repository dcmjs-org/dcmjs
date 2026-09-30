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
