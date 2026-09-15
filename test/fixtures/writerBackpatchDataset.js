import dcmjs from "../../src/index.js";

const { DicomDict } = dcmjs.data;

/**
 * Deterministic synthetic dataset builders for the writer backpatch
 * regression suite (test/writer-backpatch.test.js).
 *
 * The expected-output fixtures (test/fixtures/writer-backpatch-expected-*.bin)
 * were generated from these builders by running DicomDict.write() with the
 * PRE-backpatch eager writer (the temporary-stream + concat implementation of
 * Tag.write, see git history of src/Tag.js and src/BufferStream.js) so that
 * the reworked direct-write/backpatch writer is locked to the exact
 * historical output bytes.
 *
 * The datasets intentionally cover the cases whose header encoding depends on
 * the value length:
 * - a string VR (LT) element larger than 0xffff bytes: explicit VR must
 *   switch to the "Big 16" encoding (VR "UN" + 4-byte length field),
 * - a fixed-size binary VR (US) array larger than 0xffff bytes: same Big 16
 *   switch but with an exactly precomputable length,
 * - a > 256 byte odd-length OB element (non-encapsulated binary + padding),
 * - sequences with nested sequences (undefined length + item/sequence
 *   delimiters),
 * - encapsulated PixelData with multiple frames/fragments and a basic offset
 *   table,
 * - multi-valued string elements with VM delimiters and padding, multi-byte
 *   UTF-8, and both little- and big-endian explicit syntaxes.
 */

export const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";
export const IMPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2";
export const EXPLICIT_BIG_ENDIAN = "1.2.840.10008.1.2.2";
export const JPEG_LOSSLESS_SV1 = "1.2.840.10008.1.2.4.70";

/** A > 0xffff byte, odd-length text payload for the LT (2-byte length) VR. */
export function makeBigText() {
    let text = "";
    let i = 0;
    while (text.length < 70000) {
        text += "Backpatch regression line " + i + " with payload.\n";
        i++;
    }
    if (text.length % 2 === 0) {
        text += "X"; // force an odd byte length so the writer pads
    }
    return text;
}

/** Deterministic binary payload. */
export function makeBytes(length, seed) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = (i * seed + 11) % 256;
    }
    return bytes.buffer;
}

/** A US value list whose encoding (2 bytes per value) exceeds 0xffff bytes. */
export function makeBigUSValues() {
    const values = new Array(40000);
    for (let i = 0; i < values.length; i++) {
        values[i] = (i * 13) % 0x10000;
    }
    return values;
}

export function buildWriterBackpatchDict(
    transferSyntaxUID,
    { encapsulated = false } = {}
) {
    const dicomDict = new DicomDict({
        "00020001": { vr: "OB", Value: [new Uint8Array([0, 1]).buffer] },
        "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.88.22"] },
        "00020003": { vr: "UI", Value: ["1.2.840.99999.1.2.3.4"] },
        "00020010": { vr: "UI", Value: [transferSyntaxUID] },
        "00020012": { vr: "UI", Value: ["1.2.840.99999.0.1"] }
    });

    dicomDict.dict = {
        "00080008": { vr: "CS", Value: ["ORIGINAL", "PRIMARY"] },
        "00081030": { vr: "LO", Value: ["Štüdy – Désc"] },
        "00081115": {
            vr: "SQ",
            Value: [
                {
                    "0020000E": { vr: "UI", Value: ["1.2.840.99999.5.6.7"] },
                    "00200013": { vr: "IS", Value: [1] }
                },
                {
                    "0020000E": { vr: "UI", Value: ["1.2.840.99999.5.6.8"] },
                    "00081140": {
                        vr: "SQ",
                        Value: [
                            {
                                "00081150": {
                                    vr: "UI",
                                    Value: ["1.2.840.10008.5.1.4.1.1.88.22"]
                                },
                                "00081155": {
                                    vr: "UI",
                                    Value: ["1.2.840.99999.1.2.3.4"]
                                }
                            }
                        ]
                    }
                }
            ]
        },
        "00100010": {
            vr: "PN",
            Value: [{ Alphabetic: "Backpatch^Regression" }]
        },
        "00100020": { vr: "LO", Value: ["PATIENT-1"] },
        "00104000": { vr: "LT", Value: [makeBigText()] },
        "00189087": { vr: "FD", Value: [0.0012345678] },
        "0020000D": { vr: "UI", Value: ["1.2.840.99999.1.2.3"] },
        "00200011": { vr: "IS", Value: [5] },
        "00200032": { vr: "DS", Value: [1.5, -2.25, "3.000"] },
        "00201041": { vr: "DS", Value: ["-0.000"] },
        "00280010": { vr: "US", Value: [512] },
        "00281201": { vr: "US", Value: makeBigUSValues() },
        "00420011": { vr: "OB", Value: [makeBytes(999, 7)] },
        "00720026": { vr: "AT", Value: [0x00100020] }
    };

    if (encapsulated) {
        // Two frames: a multi-fragment even frame and an odd frame that
        // needs fragment padding.
        dicomDict.dict["7FE00010"] = {
            vr: "OB",
            Value: [makeBytes(30000, 3), makeBytes(9999, 5)]
        };
    }

    return dicomDict;
}

/** The fixture matrix shared by the capture step and the regression test. */
export const writerBackpatchCases = [
    {
        name: "explicit little endian",
        fixtureName: "writer-backpatch-expected-explicit-le.bin",
        transferSyntaxUID: EXPLICIT_LITTLE_ENDIAN
    },
    {
        name: "implicit little endian",
        fixtureName: "writer-backpatch-expected-implicit-le.bin",
        transferSyntaxUID: IMPLICIT_LITTLE_ENDIAN
    },
    {
        name: "explicit big endian",
        fixtureName: "writer-backpatch-expected-explicit-be.bin",
        transferSyntaxUID: EXPLICIT_BIG_ENDIAN
    },
    {
        name: "encapsulated pixel data",
        fixtureName: "writer-backpatch-expected-encapsulated.bin",
        transferSyntaxUID: JPEG_LOSSLESS_SV1,
        encapsulated: true
    }
];
