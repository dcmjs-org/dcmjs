/**
 * This is a data view which is split across multiple pieces, and maintains
 * a running size, with nullable chunks.
 */
export default class SplitDataView {
    buffers = [];
    views = [];
    offsets = [];
    size = 0;
    byteLength = 0;

    /** The default size is 256k */
    defaultSize = 256 * 1024;

    constructor(options = { defaultSize: 256 * 1024 }) {
        this.defaultSize = options.defaultSize || this.defaultSize;
    }

    checkSize(end) {
        while (end > this.byteLength) {
            const buffer = new ArrayBuffer(this.defaultSize);
            this.buffers.push(buffer);
            this.views.push(new DataView(buffer));
            this.offsets.push(this.byteLength);

            this.byteLength += buffer.byteLength;
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
        this.byteLength += addBuffer.byteLength;
    }

    slice(start = 0, end = this.size) {
        let index = this.findStart(start);
        if (index === undefined) {
            throw new Error(
                `Start ${start} out of range of 0...${this.byteLength}`
            );
        }
        let buffer = this.buffers[index];
        if (!buffer) {
            console.error("Buffer should be defined here");
            return;
        }
        let offset = this.offsets[index];
        let length = buffer.byteLength;
        if (end < offset + length) {
            return buffer.slice(start - offset, end - offset);
        }
        const createBuffer = new Uint8Array(end - start);
        let offsetStart = 0;
        while (start + offsetStart < end && index < this.buffers.length) {
            buffer = this.buffers[index];
            length = buffer.byteLength;
            offset = this.offsets[index];

            const bufStart = start + offsetStart - offset;
            const addLength = Math.min(
                end - start - offsetStart,
                length - bufStart
            );
            createBuffer.set(
                new Uint8Array(buffer, bufStart, addLength),
                offsetStart
            );
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
            return { view: this.views[index], viewOffset, index };
        }
        const newBuffer = this.slice(start, start + length);
        return {
            view: new DataView(newBuffer),
            viewOffset: start,
            writeCommit: true
        };
    }

    writeCommit(view, start) {
        this.writeBuffer(view.buffer, start);
    }

    writeBuffer(data, start) {
        let index = this.findStart(start);
        let offset = 0;
        while (offset < data.byteLength) {
            const buffer = this.buffers[index];
            if (!buffer) {
                throw new Error(`Not enough space to write ${data.byteLength}`);
            }
            const bufferOffset = this.offsets[index];
            const startWrite = start + offset - bufferOffset;
            const writeLen = Math.min(
                buffer.byteLength - startWrite,
                data.byteLength - offset
            );
            const byteBuffer = new Uint8Array(buffer, startWrite, writeLen);
            const setData = new Uint8Array(data, offset, writeLen);
            byteBuffer.set(setData);
            offset += writeLen;
            index++;
        }
    }

    getUint8(offset) {
        const { view, viewOffset } = this.findView(offset, 1);
        return view.getUint8(offset - viewOffset);
    }

    getUint16(offset, isLittleEndian) {
        const { view, viewOffset } = this.findView(offset, 2);
        return view.getUint16(offset - viewOffset, isLittleEndian);
    }

    getUint32(offset, isLittleEndian) {
        const { view, viewOffset } = this.findView(offset, 4);
        return view.getUint32(offset - viewOffset, isLittleEndian);
    }

    getInt8(offset) {
        const { view, viewOffset } = this.findView(offset, 1);
        return view.getInt8(offset - viewOffset);
    }

    getInt16(offset, isLittleEndian) {
        const { view, viewOffset } = this.findView(offset, 2);
        return view.getInt16(offset - viewOffset, isLittleEndian);
    }

    getInt32(offset, isLittleEndian) {
        const { view, viewOffset } = this.findView(offset, 4);
        return view.getInt32(offset - viewOffset, isLittleEndian);
    }

    setUint8(offset, value) {
        const { view, viewOffset } = this.findView(offset, 1);
        view.setUint8(offset - viewOffset, value);
        // Commit is unneeded since 1 byte will always be available
    }

    setUint16(offset, value, isLittleEndian) {
        const { view, viewOffset, writeCommit } = this.findView(offset, 2);
        view.setUint16(offset - viewOffset, value, isLittleEndian);
        if (writeCommit) {
            this.writeCommit(view, offset);
        }
    }

    setUint32(offset, value, isLittleEndian) {
        const { view, viewOffset, writeCommit } = this.findView(offset, 4);
        view.setUint32(offset - viewOffset, value, isLittleEndian);
        if (writeCommit) {
            this.writeCommit(view, offset);
        }
    }

    setInt8(offset, value) {
        const { view, viewOffset } = this.findView(offset, 1);
        view.setInt8(offset - viewOffset, value);
        // Commit is unneeded since 1 byte will always be available
    }

    setInt16(offset, value, isLittleEndian) {
        const { view, viewOffset, writeCommit } = this.findView(offset, 2);
        view.setInt16(offset - viewOffset, value, isLittleEndian);
        if (writeCommit) {
            this.writeCommit(view, offset);
        }
    }

    setInt32(offset, value, isLittleEndian) {
        const { view, viewOffset, writeCommit } = this.findView(offset, 4);
        view.setInt32(offset - viewOffset, value, isLittleEndian);
        if (writeCommit) {
            this.writeCommit(view, offset);
        }
    }
}
