/**
 * Upper bound for a single growth allocation in checkSize. Capacity grows
 * geometrically (at least doubling) up to this chunk size, after which it
 * grows linearly in chunks of this size.
 */
const MAX_GROWTH_CHUNK = 64 * 1024 * 1024;

/**
 * This is a data view which is split across multiple pieces, and maintains
 * a running size, with nullable chunks.
 */
export default class SplitDataView {
    buffers = [];
    views = [];
    offsets = [];
    lengths = [];
    size = 0;
    byteLength = 0;

    /** The default size is 256k */
    defaultSize = 256 * 1024;

    /**
     * Chunk indices appended through addZeroCopyWindow: read-only windows
     * over a caller-owned buffer (typically the parsed source file of a
     * passthrough write). writeBuffer refuses to write into them so a
     * misdirected backpatch can never corrupt the caller's buffer.
     */
    zeroCopyChunks = new Set();

    /**
     * Total bytes of WRITABLE capacity ever allocated (checkSize) or
     * adopted (addBuffer) - zero-copy windows are excluded. checkSize bases
     * its geometric growth on this instead of on `byteLength` (which
     * includes window bytes), so small re-encoded writes interleaved with
     * large passthrough windows do not amplify allocations.
     */
    writableAllocated = 0;

    /**
     * Unwritten tail of the last writable chunk that a zero-copy window
     * append truncated away ({ buffer, byteOffset, length } into the
     * chunk's backing buffer, or null). The next checkSize re-appends it as
     * a fresh chunk after the window instead of stranding it. Single slot:
     * a new spare can only be produced by truncateTo after checkSize has
     * consumed the previous one.
     */
    spareCapacity = null;

    /**
     * The set of byte arrays being consumed.  This allows adding byte
     * arrays ready to be consumed to the list, and have them available
     * once the current consume finishes.
     */
    consumed = [];

    /** The last byte index not already consumed */
    consumeOffset = -1;

    /**
     * Chunk index returned by the last findStart hit. Sequential reads
     * almost always land in the same chunk as the previous read (or the
     * next one), so findStart checks this hint before falling back to the
     * O(numBuffers) linear scan. The hint is fully re-validated against
     * offsets/lengths on every use (chunk ranges are disjoint, so a
     * validated hit is always THE chunk), and reset whenever the chunk
     * list mutates destructively (truncateTo, consume, from).
     */
    lastFoundIndex = 0;

    constructor(options = { defaultSize: 256 * 1024 }) {
        this.defaultSize = options.defaultSize || this.defaultSize;
    }

    /**
     * Consumes the already written or read data, up to the given offset.
     */
    consume(offset) {
        this.lastFoundIndex = 0;
        this.consumeOffset = Math.max(offset, this.consumeOffset);
        if (!this.consumed || !this.offsets.length) {
            return;
        }
        while (true) {
            const nextOffset = this.offsets[this.consumed.length];
            const nextLength = this.lengths[this.consumed.length];
            if (nextOffset === undefined || nextLength === undefined) {
                return;
            }
            const currentEnd = nextOffset + nextLength;
            if (this.consumeOffset < currentEnd) {
                // Haven't finished consuming all the data in the current block
                return;
            }
            // Consume the entire buffer for now.
            // Capture the chunk index before the push so the listener receives
            // the correct index, logical offset, and byte length of the chunk
            // being released.  The three-argument contract is:
            //   consumeListener(chunkIndex, logicalOffset, byteLength)
            // where chunkIndex is the position in buffers[]/views[], logicalOffset
            // is the chunk's logical byte start, and byteLength is its byte size.
            const chunkIndex = this.consumed.length;
            this.consumed.push(
                this.consumeListener?.(chunkIndex, nextOffset, nextLength)
            );
            this.buffers[this.consumed.length - 1] = null;
            this.views[this.consumed.length - 1] = null;
            // Continue loop to check if there are more buffers to consume
        }
    }

    /**
     * Returns true if there is data for
     */
    hasData(start, end) {
        if (start > this.size || end > this.size) {
            return false;
        }
        for (let i = 0; i < this.offsets.length; i++) {
            const startOffset = this.offsets[i];
            const nextOffset = startOffset + this.lengths[i];
            if (end <= nextOffset) {
                return !!this.buffers[i];
            }
            if (start <= nextOffset && end > startOffset) {
                // Enters the if conditions if start...end overlaps
                // startOffset...endOffset
                //   25...50  overlaps  25...26, 26..27, 49...50
                // but not 24..25 or 50...51
                if (!this.buffers[i + 1]) {
                    return false;
                }
            }
        }
        return true;
    }

    checkSize(end) {
        if (end <= this.byteLength) {
            return;
        }
        // First continue into the spare tail a zero-copy window append
        // truncated off the previous writable chunk (same backing buffer,
        // re-appended as a new chunk after the window) before allocating.
        if (this.spareCapacity) {
            const spare = this.spareCapacity;
            this.spareCapacity = null;
            this.buffers.push(spare.buffer);
            this.views.push(
                new DataView(spare.buffer, spare.byteOffset, spare.length)
            );
            this.offsets.push(this.byteLength);
            this.lengths.push(spare.length);
            this.byteLength += spare.length;
            if (end <= this.byteLength) {
                return;
            }
        }
        // Geometric growth: allocate at least the missing span, and grow the
        // capacity by at least 2x (capped at MAX_GROWTH_CHUNK) so large
        // writes do not degrade into thousands of fixed defaultSize chunks.
        // The growth base is the WRITABLE capacity allocated so far, NOT
        // byteLength: byteLength includes zero-copy window bytes, which
        // would make every small write after a large window allocate
        // window-sized chunks.
        const needed = end - this.byteLength;
        const growth = Math.min(this.writableAllocated, MAX_GROWTH_CHUNK);
        const allocSize = Math.max(needed, this.defaultSize, growth);
        const buffer = new ArrayBuffer(allocSize);
        this.buffers.push(buffer);
        this.views.push(new DataView(buffer));
        this.offsets.push(this.byteLength);
        this.lengths.push(buffer.byteLength);

        this.byteLength += buffer.byteLength;
        this.writableAllocated += buffer.byteLength;
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
        // Fixed in this arc: typed-array views (including pooled Node
        // Buffers) keep their byteOffset/byteLength window into the backing
        // ArrayBuffer. The old `buffer.buffer || buffer` unwrap dropped the
        // byteOffset, silently parsing the wrong bytes of a shared pool
        // (issue #311). options.start/end remain view-relative.
        let start, end;
        if (ArrayBuffer.isView(buffer)) {
            const viewOffset = buffer.byteOffset;
            const viewLength = buffer.byteLength;
            start = viewOffset + (options?.start || 0);
            end = viewOffset + (options?.end ?? viewLength);
            buffer = buffer.buffer;
        } else {
            buffer = buffer.buffer || buffer;
            start = options?.start || 0;
            end = options?.end ?? buffer.byteLength;
        }
        const transfer =
            options?.transfer ?? (start === 0 && end === buffer.byteLength);
        if (start === end) {
            return;
        }
        const chunkLength = end - start;
        const lastOffset = this.offsets.length
            ? this.offsets[this.offsets.length - 1]
            : 0;
        const lastLength = this.lengths.length
            ? this.lengths[this.lengths.length - 1]
            : 0;
        if (transfer) {
            // Adopt the backing buffer, windowed to [start, end) via an
            // offset-aware DataView (slice/writeBuffer already honor the
            // chunk view's byteOffset for zero-copy windows).
            this.buffers.push(buffer);
            this.views.push(new DataView(buffer, start, chunkLength));
        } else {
            const copied = buffer.slice(start, end);
            this.buffers.push(copied);
            this.views.push(new DataView(copied));
        }
        this.offsets.push(lastOffset + lastLength);
        this.lengths.push(chunkLength);
        this.size += chunkLength;
        this.byteLength += chunkLength;
        this.writableAllocated += chunkLength;
    }

    /**
     * Trims unwritten tail capacity so the logical end of the chunk list is
     * exactly `end` (chunks lying entirely at or beyond `end` are dropped,
     * a chunk straddling it is shortened). Used before a zero-copy append
     * so the appended window starts at the current write position instead
     * of at the end of the over-allocated capacity. The caller must
     * guarantee no data beyond `end` has been written yet.
     *
     * The trimmed-off tail of a shortened WRITABLE chunk is saved as
     * `spareCapacity` so the next checkSize continues into it after the
     * window instead of stranding it (writer hardening: without this, every
     * small-write/window alternation stranded a whole growth chunk).
     */
    truncateTo(end) {
        this.lastFoundIndex = 0;
        while (
            this.offsets.length &&
            this.offsets[this.offsets.length - 1] >= end
        ) {
            this.buffers.pop();
            this.views.pop();
            this.offsets.pop();
            this.lengths.pop();
            this.zeroCopyChunks.delete(this.buffers.length);
        }
        if (this.byteLength > end) {
            const last = this.lengths.length - 1;
            if (last >= 0) {
                const keep = end - this.offsets[last];
                const remaining = this.lengths[last] - keep;
                if (remaining > 0 && !this.zeroCopyChunks.has(last)) {
                    this.spareCapacity = {
                        buffer: this.buffers[last],
                        byteOffset: this.views[last].byteOffset + keep,
                        length: remaining
                    };
                }
                this.lengths[last] = keep;
            }
            this.byteLength = end;
        }
    }

    /**
     * Appends a READ-ONLY zero-copy window over `bytes` (a Uint8Array,
     * typically a subarray of a parsed source file) as the chunk starting
     * at logical offset `start`, trimming any unwritten capacity past
     * `start` first. The underlying ArrayBuffer is referenced, never
     * copied; writeBuffer throws if asked to write into the window.
     */
    addZeroCopyWindow(bytes, start) {
        if (bytes.byteLength === 0) {
            return;
        }
        this.truncateTo(start);
        if (this.byteLength !== start) {
            throw new Error(
                `Zero-copy window start ${start} is past the written ` +
                    `capacity ${this.byteLength}`
            );
        }
        this.zeroCopyChunks.add(this.buffers.length);
        this.buffers.push(bytes.buffer);
        this.views.push(
            new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        );
        this.offsets.push(start);
        this.lengths.push(bytes.byteLength);
        this.byteLength = start + bytes.byteLength;
        this.size = Math.max(this.size, this.byteLength);
    }

    /** Copies one view contents into this one as a mirror */
    from(view, _options) {
        this.lastFoundIndex = 0;
        const indexBase = this.buffers.length;
        this.size = view.size;
        this.byteLength = view.byteLength;
        this.offsets.push(...view.offsets);
        this.lengths.push(...view.lengths);
        this.buffers.push(...view.buffers);
        this.views.push(...view.views);
        for (const index of view.zeroCopyChunks) {
            this.zeroCopyChunks.add(indexBase + index);
        }
        this.writableAllocated += view.writableAllocated || 0;
        // TODO - use the options to skip copying irrelevant data
    }

    slice(start = 0, end = this.size) {
        if (start === end) {
            return new Uint8Array(0).buffer;
        }
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
        // Logical chunk length and buffer byteOffset: a truncated chunk is
        // shorter than its backing buffer, and a zero-copy window starts at
        // its view's byteOffset within the shared source buffer.
        let length = this.lengths[index];
        let byteOffset = this.views[index].byteOffset;
        if (end <= offset + length) {
            return buffer.slice(
                start - offset + byteOffset,
                end - offset + byteOffset
            );
        }
        const createBuffer = new Uint8Array(end - start);
        let offsetStart = 0;
        while (start + offsetStart < end && index < this.buffers.length) {
            buffer = this.buffers[index];
            length = this.lengths[index];
            offset = this.offsets[index];
            byteOffset = this.views[index].byteOffset;

            const bufStart = start + offsetStart - offset;
            const addLength = Math.min(
                end - start - offsetStart,
                length - bufStart
            );
            createBuffer.set(
                new Uint8Array(buffer, bufStart + byteOffset, addLength),
                offsetStart
            );
            offsetStart += addLength;
            index++;
        }
        return createBuffer.buffer;
    }

    findStart(start = 0) {
        const { offsets, lengths } = this;
        // Fast path: sequential reads nearly always hit the chunk of the
        // previous read, or the one immediately after it.
        const hint = this.lastFoundIndex;
        if (hint < offsets.length) {
            if (
                start >= offsets[hint] &&
                start < offsets[hint] + lengths[hint]
            ) {
                return hint;
            }
            const next = hint + 1;
            if (
                next < offsets.length &&
                start >= offsets[next] &&
                start < offsets[next] + lengths[next]
            ) {
                this.lastFoundIndex = next;
                return next;
            }
        }
        for (let index = 0; index < this.buffers.length; index++) {
            if (
                start >= offsets[index] &&
                start < offsets[index] + lengths[index]
            ) {
                this.lastFoundIndex = index;
                return index;
            }
        }
    }

    /**
     * Returns a buffer view containing the given start position.
     * Note this will return undefined if start is after the current
     * data set.
     */
    findView(start, length = 1) {
        const index = this.findStart(start);
        const viewOffset = this.offsets[index];
        const viewLength = this.lengths[index];
        if (viewOffset === undefined) {
            throw new Error(
                `Finding view is past end of input for start=${start} where offsets=${this.offsets} and lengths are ${this.lengths}`
            );
        }
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
        const dataBuffer = data.buffer || data;
        // Respect the byteOffset of typed array views so that sub-views of a
        // larger buffer copy the intended bytes.
        const dataByteOffset = data.byteOffset || 0;
        let index = this.findStart(start);
        let offset = 0;
        while (offset < data.byteLength) {
            const buffer = this.buffers[index];
            if (!buffer) {
                throw new Error(`Not enough space to write ${data.byteLength}`);
            }
            if (this.zeroCopyChunks.has(index)) {
                // The chunk aliases a caller-owned source buffer (a
                // passthrough span); writing into it would corrupt the
                // caller's data. The writer never backpatches into
                // passthrough bytes, so this is always a programming error.
                throw new Error(
                    "Cannot write into a read-only zero-copy chunk"
                );
            }
            const bufferOffset = this.offsets[index];
            const startWrite = start + offset - bufferOffset;
            const writeLen = Math.min(
                this.lengths[index] - startWrite,
                data.byteLength - offset
            );
            const byteBuffer = new Uint8Array(
                buffer,
                startWrite + this.views[index].byteOffset,
                writeLen
            );
            const setData = new Uint8Array(
                dataBuffer,
                dataByteOffset + offset,
                writeLen
            );
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

    getBigUint64(offset, isLittleEndian) {
        const { view, viewOffset } = this.findView(offset, 8);
        return view.getBigUint64(offset - viewOffset, isLittleEndian);
    }

    getFloat32(offset, isLittleEndian) {
        const { view, viewOffset } = this.findView(offset, 4);
        return view.getFloat32(offset - viewOffset, isLittleEndian);
    }

    getFloat64(offset, isLittleEndian) {
        const { view, viewOffset } = this.findView(offset, 8);
        return view.getFloat64(offset - viewOffset, isLittleEndian);
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

    setBigUint64(offset, value, isLittleEndian) {
        const { view, viewOffset, writeCommit } = this.findView(offset, 8);
        view.setBigUint64(offset - viewOffset, value, isLittleEndian);
        if (writeCommit) {
            this.writeCommit(view, offset);
        }
    }

    setFloat32(offset, value, isLittleEndian) {
        const { view, viewOffset, writeCommit } = this.findView(offset, 4);
        view.setFloat32(offset - viewOffset, value, isLittleEndian);
        if (writeCommit) {
            this.writeCommit(view, offset);
        }
    }

    setFloat64(offset, value, isLittleEndian) {
        const { view, viewOffset, writeCommit } = this.findView(offset, 8);
        view.setFloat64(offset - viewOffset, value, isLittleEndian);
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

    /**
     * Reports on the amount of memory held by the buffers in the view.
     * @param {number} consumeOffset - The current consume offset (typically from BufferStream.offset)
     * @returns {Object} An object containing:
     *   - bufferCount: Number of buffers still held (not null)
     *   - totalSize: Total size of all buffers in bytes
     *   - consumeOffset: The current consume offset
     *   - buffersBeforeOffset: Number of buffers before the consume offset
     *   - bytesBeforeOffset: Total bytes before the consume offset
     *   - writableAllocated: Total writable (non-window) bytes ever
     *     allocated or adopted by this view
     *   - zeroCopyWindowBytes: Total bytes referenced (not owned) through
     *     zero-copy window chunks
     */
    getBufferMemoryInfo(consumeOffset) {
        let bufferCount = 0;
        let totalSize = 0;
        let buffersBeforeOffset = 0;
        let bytesBeforeOffset = 0;
        let zeroCopyWindowBytes = 0;
        const currentConsumeOffset = consumeOffset ?? this.consumeOffset;

        for (const index of this.zeroCopyChunks) {
            zeroCopyWindowBytes += this.lengths[index];
        }

        for (let i = 0; i < this.buffers.length; i++) {
            const buffer = this.buffers[i];
            if (buffer !== null && buffer !== undefined) {
                bufferCount++;
                totalSize += buffer.byteLength;

                // Count buffers and bytes that are before the consume offset
                const bufferStart = this.offsets[i];
                const bufferEnd = bufferStart + this.lengths[i];
                if (bufferEnd <= currentConsumeOffset) {
                    // Buffer is completely before the offset
                    buffersBeforeOffset++;
                    bytesBeforeOffset += buffer.byteLength;
                } else if (bufferStart < currentConsumeOffset) {
                    // Buffer spans the offset, count the portion before it
                    bytesBeforeOffset += currentConsumeOffset - bufferStart;
                }
            }
        }

        return {
            bufferCount,
            totalSize,
            consumeOffset: currentConsumeOffset,
            buffersBeforeOffset,
            bytesBeforeOffset,
            writableAllocated: this.writableAllocated,
            zeroCopyWindowBytes
        };
    }
}
