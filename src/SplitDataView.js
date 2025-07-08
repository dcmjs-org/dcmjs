/**
 * This is a data view which is split across multiple pieces, and maintains
 * a running size, with nullable chunks.
 */
export default class SplitDataView {
    buffers = [];
    views = [];
    offsets = [];
    size = 0;
    availableSize = 0;

    /** The default size is 256k */
    defaultSize = 256 * 1024;

    constructor(options = { defaultSize: 256 * 1024 }) {
        this.defaultSize = options.defaultSize || this.defaultSize;
    }

    checkSize(end) {
        if (!buffers.length) {
            this.buffers.push(new ArrayBuffer(this.defaultSize));
            this.views.push(new DataView(this.buffers[0]));
            this.offsets.push(0);
            this.availableSize += this.defaultSize;
        }
        while (end > this.availableSize) {
            const buffer = new ArrayBuffer(this.defaultSize);
            this.buffers.push(buffer);
            this.views.push(new DataView(buffer));
            this.offsets.push(
                this.offsets[this.offsets.length - 1] + buffer.byteLength
            );
            this.availableSize += buffer.byteLength;
        }
    }

    /**
     * Adds the buffer to the end of the current buffers list,
     * updating the size etc.
     *
     * @param {*} buffer
     * @param {*} options.start for the start of the new buffer to use
     * @param {*} options.end for the end of the buffer to use
     * @param {*} options.transfer to transfer the buffer to be owned
     */
    addBuffer(buffer, options = null) {
        buffer = buffer.buffer || buffer;
        const start = options?.start || 0;
        const end = options?.end || buffer.byteLength;
        const transfer = options?.transfer;
        if (start === end) {
            return;
        }
        const addBuffer = transfer ? buffer : buffer.slice(start, end);
        const lastOffset = this.offsets.length
            ? this.offsets[this.offsets.length - 1]
            : 0;
        const lastLength = this.buffers.length
            ? this.buffers[this.buffers.length - 1]?.byteLength
            : 0;
        this.buffers.push(addBuffer);
        this.views.push(new DataView(addBuffer));
        this.offsets.push(lastOffset + lastLength);
        this.size += addBuffer.byteLength;
    }

    slice(start = 0, end = this.size) {
        let index = this.findStart(start);
        if (index === undefined) {
            throw new Error(`Start ${start} out of range of 0...${this.size}`);
        }
        let buffer = this.buffers[index];
        let offset = this.offsets[index];
        let length = buffer.byteLength;
        if (end < offset + length) {
            return buffer.slice(start - offset, end - offset);
        }
        const createBuffer = new Uint8Array(end - start);
        let offsetStart = 0;
        while (start < end && index < this.buffers.length) {
            buffer = this.buffers[index];
            length = buffer.byteLength;
            offset = this.offsets[index];

            const addLength = Math.min(end - offset, length) - start + offset;
            createBuffer.set(
                new Uint8Array(buffer, start - offset, addLength),
                offsetStart
            );
            start = length;
            offsetStart += addLength;
            index++;
        }
        return createBuffer.buffer;
    }

    findStart(start = 0) {
        for (let index = 0; index < this.buffers.length; index++) {
            if (
                start >= this.offsets[index] &&
                start < this.offsets[index] + this.buffers[index].byteLength
            ) {
                return index;
            }
        }
    }

    findView(start, length = 1) {
        const index = this.findStart(start);
        const buffer = this.buffers[index];
        const viewOffset = this.offsets[index];
        const viewLength = buffer.byteLength;
        if (start + length - viewOffset <= viewLength) {
            return { view: this.views[index], viewOffset };
        }
        const newBuffer = this.slice(start, start + length);
        return {
            view: new DataView(newBuffer),
            viewOffset: start,
            writeCommit: true
        };
    }

    writeCommit(start, view, viewOffset, length) {
        throw new Error("TODO");
    }

    getUint8(offset) {
        const { view, viewOffset } = this.findView(offset, 1);
        return view.getUint8(offset - viewOffset);
    }

    getUint16(offset) {
        const { view, viewOffset } = this.findView(offset, 2);
        return view.getUint16(offset - viewOffset);
    }

    getUint32(offset) {
        const { view, viewOffset } = this.findView(offset, 4);
        return view.getUint32(offset - viewOffset);
    }

    getInt8(offset) {
        const { view, viewOffset } = this.findView(offset, 1);
        return view.getInt8(offset - viewOffset);
    }

    getInt16(offset) {
        const { view, viewOffset } = this.findView(offset, 2);
        return view.getInt16(offset - viewOffset);
    }

    getInt32(offset) {
        const { view, viewOffset } = this.findView(offset, 4);
        return view.getInt32(offset - viewOffset);
    }

    setUint8(offset, value) {
        const { view, viewOffset } = this.findView(offset, 4);
        view.setUint8(offset - viewOffset, value);
        // Commit is unneeded since 1 byte will always be available
    }

    setUint16(offset, value) {
        const { view, viewOffset, writeCommit } = this.findView(offset, 2);
        view.setUint8(offset - viewOffset, value);
        if (writeCommit) {
            this.writeCommit(offset, view, viewOffset, 2);
        }
    }
}
