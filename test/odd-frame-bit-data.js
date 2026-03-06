/**
 * Test data for odd frame length frames.
 * Contains 3 frames with 7 bits each, totaling 21 bits (2 bytes + 5 bits, odd total).
 *
 * Frame structure:
 * - bitsAllocated = 1 (single bit per pixel)
 * - rows * cols * samplesPerPixel = 7 (not a multiple of 8)
 * - Frame 1: 7 bits (bits 0-6)
 * - Frame 2: 7 bits (bits 7-13, continuing from frame 1)
 * - Frame 3: 7 bits (bits 14-20, continuing from frame 2)
 *
 * Total: 21 bits = 2 bytes + 5 bits (not even byte-aligned, requires 3 bytes)
 *
 * Packed data: frames are packed sequentially bit-by-bit without byte alignment
 * Unpacked: each frame is extracted starting at byte 0
 */

export const oddFrameBitData = {
    // Number of frames
    numberOfFrames: 3,

    // Frame configuration
    rows: 7,
    columns: 1,
    samplesPerPixel: 1,
    bitsAllocated: 1, // Single bit per pixel (required for odd-length bit frames)

    // Bits per frame: 1 * 1 * 1 * 7 = 7 bits
    bitsPerFrame: 7,

    // Total bits: 3 * 7 = 21 bits (odd, not even byte-aligned)
    totalBits: 21,

    // Bytes needed: Math.ceil(21 / 8) = 3 bytes
    totalBytes: 3,

    /**
     * Gets the packed pixel data as it would appear in a DICOM file.
     * Frames are packed sequentially: Frame 1 (7 bits) + Frame 2 (7 bits) + Frame 3 (7 bits)
     * Total: 21 bits stored in 3 bytes
     *
     * Byte 0: Frame 1 (7 bits: 01111111) + Frame 2 bit 0 (1 bit: 0) = 01111111 0 = 0xFE
     * Byte 1: Frame 2 bits 1-6 (6 bits: 111111) + Frame 3 bits 0-1 (2 bits: 00) = 111111 00 = 0xFC
     * Byte 2: Frame 3 bits 2-6 (5 bits: 11111) + padding (3 bits: 000) = 11111 000 = 0xF8
     *
     * However, for simplicity in testing, we'll use a representation where
     * each frame's data is more clearly identifiable. We'll use:
     * - Frame 1: 0x7F (01111111) - 7 bits
     * - Frame 2: 0x3F (00111111) - 7 bits
     * - Frame 3: 0x1F (00011111) - 7 bits
     */
    getPackedData() {
        // Create a buffer to hold all frames (3 bytes for 21 bits)
        const buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);

        // Pack frames sequentially:
        // Frame 1: 0x7F = 01111111 (7 bits)
        // Frame 2: 0x3F = 00111111 (7 bits)
        // Frame 3: 0x1F = 00011111 (7 bits)

        // Packed representation (21 bits in 3 bytes):
        // Byte 0: Frame 1 (7 bits: 01111111) + Frame 2 bit 0 (1 bit: 0) = 01111111 0 = 11111110 = 0xFE
        // Byte 1: Frame 2 bits 1-6 (6 bits: 011111) + Frame 3 bits 0-1 (2 bits: 00) = 011111 00 = 01111100 = 0x7C
        // Byte 2: Frame 3 bits 2-6 (5 bits: 11111) + padding (3 bits: 000) = 11111 000 = 11111000 = 0xF8

        // But wait, Frame 2 is 0x3F = 00111111, so bits 1-6 are 011111, not 111111
        // Let me recalculate:
        // Frame 1: 0x7F = 01111111 (bits 0-6)
        // Frame 2: 0x3F = 00111111 (bits 7-13)
        // Frame 3: 0x1F = 00011111 (bits 14-20)

        // Byte 0: Frame 1 (01111111) + Frame 2 bit 7 (0) = 01111111 0 = 11111110 = 0xFE
        // Byte 1: Frame 2 bits 8-13 (011111) + Frame 3 bits 14-15 (00) = 011111 00 = 01111100 = 0x7C
        // Byte 2: Frame 3 bits 16-20 (11111) + padding (000) = 11111 000 = 11111000 = 0xF8

        view.setUint8(0, 0xfe);
        view.setUint8(1, 0x7c);
        view.setUint8(2, 0xf8);

        return buffer;
    },

    /**
     * Gets the expected unpacked frame data (each frame starting at byte 0)
     *
     * Packed data:
     * - Byte 0: 0xFE = 11111110
     * - Byte 1: 0x7C = 01111100
     * - Byte 2: 0xF8 = 11111000
     *
     * Frame 1 (bits 0-6 from packed):
     * - Bits 0-6 from byte 0: 1111111
     * - Unpacked to byte 0: 11111110 = 0xFE
     *
     * Frame 2 (bits 7-13 from packed):
     * - Bit 7 from byte 0: 0
     * - Bits 8-13 from byte 1: 011111
     * - Unpacked to byte 0: 00111110 = 0x3E
     *
     * Frame 3 (bits 14-20 from packed):
     * - Bit 14 from byte 1: 0
     * - Bit 15 from byte 1: 0
     * - Bits 16-20 from byte 2: 11111
     * - Unpacked to byte 0: 00111110 = 0x3E
     */
    getExpectedFrames() {
        // Frame 1: 1111111 (7 bits) -> byte 0: 11111110 = 0xFE
        // Frame 2: 0011111 (7 bits) -> byte 0: 00111110 = 0x3E
        // Frame 3: 0011111 (7 bits) -> byte 0: 00111110 = 0x3E

        // Actually, let me recalculate Frame 3 more carefully:
        // Bit 14 (byte 1, bit 6) = 0
        // Bit 15 (byte 1, bit 7) = 0
        // Bit 16 (byte 2, bit 0) = 1
        // Bit 17 (byte 2, bit 1) = 1
        // Bit 18 (byte 2, bit 2) = 1
        // Bit 19 (byte 2, bit 3) = 1
        // Bit 20 (byte 2, bit 4) = 1
        // So Frame 3 = 0 0 1 1 1 1 1 = 0011111
        // Unpacked: 00111110 = 0x3E

        return [
            new Uint8Array([0xfe]), // Frame 1: 11111110
            new Uint8Array([0x3e]), // Frame 2: 00111110
            new Uint8Array([0x3e]) // Frame 3: 00111110
        ];
    },

    // Expected individual frame data (each frame read as bytes, but only 7 bits are valid)
    // Note: The method will read Math.ceil(7/8) = 1 byte per frame
    // Each frame is unpacked starting at byte 0
    expectedFrameBytes: [
        1, // Frame 1: 1 byte (7 bits, unpacked to start at byte 0)
        1, // Frame 2: 1 byte (7 bits, unpacked to start at byte 0)
        1 // Frame 3: 1 byte (7 bits, unpacked to start at byte 0)
    ]
};
