// src/image/jpegInfo.js
//
// Minimal JPEG header inspection: read the SOF (start-of-frame) segment to
// recover the geometry DICOM needs (Rows/Columns/SamplesPerPixel/precision)
// and identify the matching transfer syntax — WITHOUT decoding any pixels.
// JPEG is a legal DICOM transfer syntax, so JPEG bytes can be carried as
// encapsulated PixelData verbatim; only the frame header must be understood.

const JPEG_BASELINE_TS = "1.2.840.10008.1.2.4.50"; // SOF0, process 1
const JPEG_EXTENDED_TS = "1.2.840.10008.1.2.4.51"; // SOF1, processes 2 & 4
const JPEG_LOSSLESS_TS = "1.2.840.10008.1.2.4.57"; // SOF3, process 14

/**
 * @param {Uint8Array} bytes - JPEG file bytes (SOI onward)
 * @returns {{ rows, columns, samplesPerPixel, bitsAllocated,
 *   transferSyntaxUID: string|null, sofMarker: number }}
 * @throws on non-JPEG input or a missing frame header
 */
export function parseJpegInfo(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new Error("parseJpegInfo: input is not JPEG (missing SOI)");
    }

    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset++;
            continue;
        }
        const marker = bytes[offset + 1];
        // standalone markers without a length field
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        if (marker === 0xd9 || marker === 0xda) {
            break; // EOI or start-of-scan: no SOF was seen
        }
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];

        // SOF0-SOF15, excluding DHT (C4), JPG (C8), DAC (CC)
        const isSof =
            marker >= 0xc0 &&
            marker <= 0xcf &&
            marker !== 0xc4 &&
            marker !== 0xc8 &&
            marker !== 0xcc;
        if (isSof) {
            const p = offset + 4;
            const info = {
                sofMarker: marker,
                bitsAllocated: bytes[p],
                rows: (bytes[p + 1] << 8) | bytes[p + 2],
                columns: (bytes[p + 3] << 8) | bytes[p + 4],
                samplesPerPixel: bytes[p + 5],
                transferSyntaxUID: null
            };
            if (marker === 0xc0) {
                info.transferSyntaxUID = JPEG_BASELINE_TS;
            } else if (marker === 0xc1) {
                info.transferSyntaxUID = JPEG_EXTENDED_TS;
            } else if (marker === 0xc3) {
                info.transferSyntaxUID = JPEG_LOSSLESS_TS;
            }
            // other SOFs (progressive C2, arithmetic, hierarchical) have no
            // DICOM transfer syntax — transferSyntaxUID stays null and the
            // caller decides how loudly to complain.
            return info;
        }
        offset += 2 + length;
    }
    throw new Error(
        "parseJpegInfo: no frame header (SOF) found — truncated or invalid JPEG"
    );
}
