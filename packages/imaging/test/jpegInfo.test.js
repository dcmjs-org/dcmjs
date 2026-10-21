// test/jpegInfo.test.js
//
// parseJpegInfo: SOF geometry extraction and the JPEG → DICOM transfer
// syntax mapping, over bytes built inline — no binary fixtures. The
// truncation cases pin review finding 9: a JPEG cut inside the SOF field
// span must throw, never return zero-coerced geometry.

import { parseJpegInfo } from "../src/jpegInfo.js";

const JPEG_BASELINE_TS = "1.2.840.10008.1.2.4.50";
const JPEG_EXTENDED_TS = "1.2.840.10008.1.2.4.51";
const JPEG_LOSSLESS_TS = "1.2.840.10008.1.2.4.57";

/**
 * A minimal structurally valid JPEG: SOI, APP0 stub, optional APP14 Adobe,
 * SOF, EOI. `sampling` holds the H/V byte of each component.
 */
function makeJpeg({
    sofMarker = 0xc0,
    precision = 8,
    rows = 480,
    columns = 640,
    components = 3,
    ids = [1, 2, 3, 4],
    sampling = [0x11, 0x11, 0x11, 0x11],
    adobeTransform
} = {}) {
    const componentSpecs = [];
    for (let i = 0; i < components; i++) {
        componentSpecs.push(ids[i], sampling[i], 0);
    }
    const adobe =
        adobeTransform === undefined
            ? []
            : [0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65].concat([
                  0,
                  100,
                  0,
                  0,
                  0,
                  0,
                  adobeTransform
              ]);
    const sofLength = 8 + components * 3;
    return Uint8Array.from([
        0xff,
        0xd8, // SOI
        0xff,
        0xe0,
        0x00,
        0x04,
        0x4a,
        0x46, // APP0 stub
        ...adobe,
        0xff,
        sofMarker,
        (sofLength >> 8) & 0xff,
        sofLength & 0xff,
        precision,
        (rows >> 8) & 0xff,
        rows & 0xff,
        (columns >> 8) & 0xff,
        columns & 0xff,
        components,
        ...componentSpecs,
        0xff,
        0xd9 // EOI
    ]);
}

describe("parseJpegInfo", () => {
    it("reads geometry and maps SOF0 to the baseline transfer syntax", () => {
        const info = parseJpegInfo(makeJpeg());
        expect(info.rows).toBe(480);
        expect(info.columns).toBe(640);
        expect(info.bitsAllocated).toBe(8);
        expect(info.samplesPerPixel).toBe(3);
        expect(info.sofMarker).toBe(0xc0);
        expect(info.transferSyntaxUID).toBe(JPEG_BASELINE_TS);
    });

    it("maps SOF1 to extended and SOF3 to lossless", () => {
        expect(
            parseJpegInfo(makeJpeg({ sofMarker: 0xc1 })).transferSyntaxUID
        ).toBe(JPEG_EXTENDED_TS);
        expect(
            parseJpegInfo(makeJpeg({ sofMarker: 0xc3, components: 1 }))
                .transferSyntaxUID
        ).toBe(JPEG_LOSSLESS_TS);
    });

    it("gives DICOM bit depths: 12-bit precision is BitsAllocated 16, BitsStored 12", () => {
        const info = parseJpegInfo(
            makeJpeg({ sofMarker: 0xc1, precision: 12, components: 1 })
        );
        expect(info.bitsAllocated).toBe(16);
        expect(info.bitsStored).toBe(12);
        expect(info.photometricInterpretation).toBe("MONOCHROME2");
    });

    it.each([
        ["subsampled chroma", { sampling: [0x21, 0x11, 0x11] }, "YBR_FULL_422"],
        ["no subsampling (4:4:4)", {}, "YBR_FULL"],
        ["component IDs R, G, B", { ids: [0x52, 0x47, 0x42] }, "RGB"],
        ["Adobe transform 0", { adobeTransform: 0 }, "RGB"],
        [
            "Adobe transform 1 over R, G, B IDs",
            { adobeTransform: 1, ids: [0x52, 0x47, 0x42] },
            "YBR_FULL"
        ],
        ["lossless SOF3", { sofMarker: 0xc3 }, "RGB"],
        ["4 components (CMYK)", { components: 4 }, null]
    ])("photometric interpretation: %s", (_, options, expected) => {
        expect(parseJpegInfo(makeJpeg(options)).photometricInterpretation).toBe(
            expected
        );
    });

    it("leaves the transfer syntax null for progressive (SOF2)", () => {
        const info = parseJpegInfo(makeJpeg({ sofMarker: 0xc2 }));
        expect(info.transferSyntaxUID).toBeNull();
        expect(info.columns).toBe(640);
    });

    it("rejects non-JPEG input (missing SOI)", () => {
        expect(() => parseJpegInfo(new Uint8Array(16).fill(0x41))).toThrow(
            /not JPEG/
        );
    });

    it("rejects a JPEG with no SOF before EOI", () => {
        expect(() =>
            parseJpegInfo(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))
        ).toThrow(/no frame header/);
    });

    // Review finding 9: the exact vector from the review map — a 480×640
    // JPEG cut one byte into the width field. The unfixed reader returned
    // columns 512 (undefined coerced to 0 in the bitwise OR) and the wrong
    // geometry flowed silently into the built dataset.
    it("throws on a JPEG cut one byte into the SOF width field (finding 9)", () => {
        const truncated = Uint8Array.from([
            0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02
        ]);
        expect(() => parseJpegInfo(truncated)).toThrow(/truncated/);
    });

    // Finding 9, second shape: cut right after the SOF length field. The
    // unfixed reader returned rows 0, columns 0, and no bit depth.
    it("throws on a JPEG cut right after the SOF length field (finding 9)", () => {
        const truncated = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11]);
        expect(() => parseJpegInfo(truncated)).toThrow(/truncated/);
    });
});
