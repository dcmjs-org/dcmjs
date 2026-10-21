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

const LOSSLESS_SOF_MARKERS = new Set([0xc3, 0xc7, 0xcb, 0xcf]);
const RGB_COMPONENT_IDS = [0x52, 0x47, 0x42]; // "R", "G", "B"

/**
 * The PhotometricInterpretation of the compressed data (PS3.5 8.2.1), or
 * null when DICOM has no value for it (for example 4-component CMYK).
 *
 * - 1 component: MONOCHROME2.
 * - 3 components: RGB when the data has no colour transform, that is an
 *   Adobe APP14 transform of 0, the component IDs "R", "G", "B", or a
 *   lossless process. Otherwise YBR_FULL when no component is subsampled,
 *   and YBR_FULL_422 when the chroma is subsampled.
 */
function photometricInterpretation(sofMarker, components, adobeTransform) {
    if (components.length === 1) {
        return "MONOCHROME2";
    }
    if (components.length !== 3) {
        return null;
    }
    const isRgb =
        adobeTransform === 0 ||
        (adobeTransform === undefined &&
            components.every((c, i) => c.id === RGB_COMPONENT_IDS[i])) ||
        (adobeTransform === undefined && LOSSLESS_SOF_MARKERS.has(sofMarker));
    if (isRgb) {
        return "RGB";
    }
    const subsampled = components.some(
        c => c.sampling !== components[0].sampling
    );
    return subsampled ? "YBR_FULL_422" : "YBR_FULL";
}

/**
 * Read the JPEG frame header. The DICOM values are ready for
 * buildImageDataset: `bitsAllocated` is 8 or 16, `bitsStored` is the sample
 * precision, and `photometricInterpretation` follows PS3.5 8.2.1.
 *
 * @param {Uint8Array} bytes - JPEG file bytes (SOI onward)
 * @returns {{ rows, columns, samplesPerPixel, bitsAllocated, bitsStored,
 *   photometricInterpretation: string|null,
 *   transferSyntaxUID: string|null, sofMarker: number }}
 * @throws on non-JPEG input or a missing frame header
 */
export function parseJpegInfo(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new Error("parseJpegInfo: input is not JPEG (missing SOI)");
    }

    let adobeTransform;
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

        // APP14 "Adobe": the transform byte follows "Adobe", the version,
        // and two flag words.
        if (
            marker === 0xee &&
            length >= 14 &&
            offset + 2 + length <= bytes.length &&
            String.fromCharCode(...bytes.subarray(offset + 4, offset + 9)) ===
                "Adobe"
        ) {
            adobeTransform = bytes[offset + 15];
        }

        // SOF0-SOF15, excluding DHT (C4), JPG (C8), DAC (CC)
        const isSof =
            marker >= 0xc0 &&
            marker <= 0xcf &&
            marker !== 0xc4 &&
            marker !== 0xc8 &&
            marker !== 0xcc;
        if (isSof) {
            // The six SOF fields span bytes[offset+4 .. offset+9], and the
            // declared segment must fit inside the input. Out-of-range reads
            // coerce to 0 in the bitwise math below, so a truncated JPEG
            // would silently return wrong geometry (review finding 9).
            const p = offset + 4;
            const samplesPerPixel = bytes[p + 5];
            if (
                length < 8 + 3 * (samplesPerPixel || 0) ||
                offset + 2 + length > bytes.length
            ) {
                throw new Error(
                    "parseJpegInfo: truncated SOF segment — the frame header does not fit in the input"
                );
            }
            const components = [];
            for (let i = 0; i < samplesPerPixel; i++) {
                components.push({
                    id: bytes[p + 6 + 3 * i],
                    sampling: bytes[p + 7 + 3 * i]
                });
            }
            const precision = bytes[p];
            const info = {
                sofMarker: marker,
                bitsAllocated: precision > 8 ? 16 : 8,
                bitsStored: precision,
                rows: (bytes[p + 1] << 8) | bytes[p + 2],
                columns: (bytes[p + 3] << 8) | bytes[p + 4],
                samplesPerPixel,
                photometricInterpretation: photometricInterpretation(
                    marker,
                    components,
                    adobeTransform
                ),
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
