/**
 * Encodes a non-bitpacked frame which has one sample per pixel.
 *
 * @param {*} buffer
 * @param {*} numberOfFrames
 * @param {*} rows
 * @param {*} cols
 */
function encode(buffer, numberOfFrames, rows, cols) {
    const frameLength = rows * cols;

    const header = createHeader();
    let encodedFrames = [];

    for (let frame = 0; frame < numberOfFrames; frame++) {
        const frameOffset = frameLength * frame;

        encodedFrames.push(
            encodeFrame(buffer, frameOffset, rows, cols, header)
        );
    }

    return encodedFrames;
}

function encodeFrame(buffer, frameOffset, rows, cols, header) {
    // Add header to frame:
    const rleArray = [];

    for (let r = 0; r < rows; r++) {
        const rowOffset = r * cols;
        const uint8Row = new Uint8Array(buffer, frameOffset + rowOffset, cols);

        let i = 0;

        while (i < uint8Row.length) {
            const literalRunLength = getLiteralRunLength(uint8Row, i);

            if (literalRunLength) {
                // State how many in litteral run
                rleArray.push(literalRunLength - 1);
                // Append litteral run.
                rleArray.concat(...uint8Row.slice(i, i + literalRunLength));

                i += literalRunLength;
            }

            if (i >= uint8Row.length) {
                break;
            }

            // Next must be a replicate run.
            const replicateRunLength = getReplicateRunLength(uint8Row, i);

            if (replicateRunLength) {
                // State how many in replicate run
                rleArray.push(257 - replicateRunLength);
                rleArray.push(uint8Row[i]);

                i += replicateRunLength;
            }
        }
    }

    const encodedFrameBuffer = new ArrayBuffer(64 + rleArray.length);

    // Copy header into encodedFrameBuffer.
    const headerView = new Uint32Array(encodedFrameBuffer, 0, 16);

    for (let i = 0; i < headerView.length; i++) {
        headerView[i] = header[i];
    }

    for (let i = 0; i < header.length; i++) {
        rleArray.push(header[i]);
    }

    // Copy rle data into encodedFrameBuffer.
    const bodyView = new Uint8Array(encodedFrameBuffer, 64);

    for (let i = 0; i < rleArray; i++) {
        bodyView[i] = rleArray[i];
    }

    return encodedFrameBuffer;
}

function createHeader() {
    const headerUint32 = new Uint32Array(16);

    headerUint32[0] = 1; // 1 Segment.
    headerUint32[1] = 64; // Data offset is 64 bytes.

    // Return byte-array version of header:
    return headerUint32;
}

function getLiteralRunLength(uint8Row, i) {
    for (var l = 0; l < uint8Row.length - i; l++) {
        if (
            uint8Row[i + l] === uint8Row[i + l + 1] &&
            uint8Row[i + l + 1] === uint8Row[i + l + 2]
        ) {
            return l;
        }

        if (l === 128) {
            return l;
        }
    }
    return uint8Row.length - i;
}

function getReplicateRunLength(uint8Row, i) {
    const first = uint8Row[i];
    for (let l = 1; l < uint8Row.length - i; l++) {
        if (uint8Row[i + l] !== first) {
            return l;
        }

        if (l === 128) {
            return l;
        }
    }

    return uint8Row.length - i;
}

function decode(buffer) {
    // READ Header
    // Loop through segments
}

export { encode, decode };
