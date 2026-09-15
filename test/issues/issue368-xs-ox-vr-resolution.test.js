/**
 * Dictionary meta-VRs "xs" and "ox" under Implicit VR Little Endian.
 *
 * Issue #368 — "Lots of 'Invalid vr type... ' log messages in dcmjs
 * release 0.29.11"
 * https://github.com/dcmjs-org/dcmjs/issues/368
 * Symptom: OHIF consoles filled with "Invalid vr type xs - using US"
 * for every element whose DICOM dictionary VR is the "US or SS"
 * meta-VR (e.g. (0028,0106) SmallestImagePixelValue, (0028,0107)
 * LargestImagePixelValue). Per PS3.5, "xs" should resolve US-vs-SS by
 * PixelRepresentation — silently.
 *
 * Issue #437 — "When converting Philip MR files to JSON … Invalid tag
 * in sequence error." (folded: the log-spam half)
 * https://github.com/dcmjs-org/dcmjs/issues/437
 * Symptom: "Invalid vr type ox - using OW." for elements whose
 * dictionary VR is the "OB or OW" meta-VR (e.g. (7FE0,0010) PixelData,
 * (5400,1010) WaveformData). "ox" should resolve OB-vs-OW by context —
 * silently. (The Philips "Invalid tag in sequence" half needs the
 * original fixture and is not reproducible synthetically; only the
 * VR-resolution/logging half is covered here.)
 *
 * Triage: A — synthetic implicit-VR files via createSampleDicom (the
 * helper writes the body with the meta transfer syntax).
 *
 * 1.0 status pinned here (loglevel is jest-mocked in jest.setup.js, so
 * validationLog.warn/error are inspectable jest.fn()s):
 *  - green: ValueRepresentation.createByTypeString demotes the xs/ox
 *    fallback to validationLog.debug — no warn/error spam at the default
 *    level (the literal #368/#437 complaint).
 *  - green: with PixelRepresentation 0, xs→US is the correct resolution
 *    and values parse intact; ox→OW yields byte-intact bulk data (in
 *    little-endian files OB-vs-OW has no observable byte effect, so the
 *    missing BitsAllocated-based OB/OW choice is documented, not a gap).
 *  - KNOWN GAP: with PixelRepresentation 1, xs still resolves to US —
 *    negative SS values come back as their unsigned reinterpretation
 *    (-2 → 65534). The PS3.5 PixelRepresentation-driven US-vs-SS
 *    resolution is not implemented (DicomMessage._readTag has only a
 *    dead `vrType == "xs"` branch on the unknown-tag path).
 */

// The default-export import wires Tag/ValueRepresentation to
// DicomMessage (setDicomMessageClass side effects in src/index.js) —
// required for the implicit write path used by the helper.
import "../../src/index.js";
import { DicomMessage } from "../../src/DicomMessage.js";
import { Tag } from "../../src/Tag.js";
import { validationLog } from "../../src/log.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";
import { TagHex } from "../../src/constants/dicom.js";

validationLog.setLevel(5);

const IMPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2";
const SMALLEST_PIXEL_VALUE = "00280106"; // dictionary VR "xs"
const LARGEST_PIXEL_VALUE = "00280107"; // dictionary VR "xs"
const WAVEFORM_DATA = "54001010"; // dictionary VR "ox"
const PIXEL_BYTES = 64 * 32 * 3;

function implicitSample(dictUpdates) {
    return createSampleDicom({
        meta: {
            [TagHex.TransferSyntaxUID]: {
                vr: "UI",
                Value: [IMPLICIT_LITTLE_ENDIAN]
            }
        },
        dict: dictUpdates
    });
}

function invalidVrCalls(mockFn) {
    return mockFn.mock.calls.filter(
        args => typeof args[0] === "string" && args[0].includes("Invalid vr")
    );
}

beforeEach(() => {
    validationLog.warn.mockClear();
    validationLog.error.mockClear();
});

describe("issues #368/#437 — dictionary meta-VRs xs/ox resolve silently", () => {
    it("sanity: the dictionary really carries the meta-VRs", () => {
        expect(
            DicomMessage.lookupTag(Tag.fromString(SMALLEST_PIXEL_VALUE)).vr
        ).toBe("xs");
        expect(
            DicomMessage.lookupTag(Tag.fromString(TagHex.PixelData)).vr
        ).toBe("ox");
        expect(DicomMessage.lookupTag(Tag.fromString(WAVEFORM_DATA)).vr).toBe(
            "ox"
        );
    });

    it("xs with PixelRepresentation 0: resolves to US with intact values and NO warn/error log spam", () => {
        const buffer = implicitSample({
            [TagHex.PixelRepresentation]: { vr: "US", Value: [0] },
            [SMALLEST_PIXEL_VALUE]: { vr: "US", Value: [2] },
            [LARGEST_PIXEL_VALUE]: { vr: "US", Value: [513] }
        });
        const { dict } = DicomMessage.readFile(buffer);
        expect(dict[SMALLEST_PIXEL_VALUE].vr).toBe("US");
        expect(dict[SMALLEST_PIXEL_VALUE].Value).toEqual([2]);
        expect(dict[LARGEST_PIXEL_VALUE].Value).toEqual([513]);
        // The literal #368 complaint: no visible "Invalid vr type" spam.
        expect(invalidVrCalls(validationLog.warn)).toHaveLength(0);
        expect(invalidVrCalls(validationLog.error)).toHaveLength(0);
    });

    // Fixed in this arc: DicomMessage._read threads the parsed
    // (0028,0103) PixelRepresentation value through the per-element read
    // options, and _readTag resolves dictionary VR "xs" to SS when
    // PixelRepresentation is 1 (US otherwise, including when absent) —
    // PS3.5's US-vs-SS resolution, replacing the dead `vrType == "xs"`
    // branch on the unknown-tag path.
    it("#368: xs with PixelRepresentation 1 resolves to SS (negative values intact)", () => {
        const buffer = implicitSample({
            [TagHex.PixelRepresentation]: { vr: "US", Value: [1] },
            [SMALLEST_PIXEL_VALUE]: { vr: "SS", Value: [-2] },
            [LARGEST_PIXEL_VALUE]: { vr: "SS", Value: [-3] }
        });
        const { dict } = DicomMessage.readFile(buffer);
        expect(dict[SMALLEST_PIXEL_VALUE].vr).toBe("SS");
        expect(dict[SMALLEST_PIXEL_VALUE].Value).toEqual([-2]);
        expect(dict[LARGEST_PIXEL_VALUE].Value).toEqual([-3]);
    });

    it("ox on PixelData: resolves to OW/OB with byte-intact data and NO warn/error log spam", () => {
        const pixels = new Uint8Array(PIXEL_BYTES);
        for (let i = 0; i < pixels.length; i++) {
            pixels[i] = i % 251;
        }
        const buffer = implicitSample({
            [TagHex.PixelData]: { vr: "OB", Value: [pixels.buffer] }
        });
        const { dict } = DicomMessage.readFile(buffer);
        const pixelData = dict[TagHex.PixelData];
        expect(["OW", "OB"]).toContain(pixelData.vr);
        const parsed = new Uint8Array(pixelData.Value[0]);
        expect(parsed.length).toBe(PIXEL_BYTES);
        expect(parsed).toEqual(pixels);
        expect(invalidVrCalls(validationLog.warn)).toHaveLength(0);
        expect(invalidVrCalls(validationLog.error)).toHaveLength(0);
    });

    it("ox on WaveformData: resolves to OW/OB with byte-intact data, silently", () => {
        const waveform = new Uint8Array(32);
        for (let i = 0; i < waveform.length; i++) {
            waveform[i] = 0xf0 - i;
        }
        const buffer = implicitSample({
            [WAVEFORM_DATA]: { vr: "OW", Value: [waveform.buffer] }
        });
        const { dict } = DicomMessage.readFile(buffer);
        const element = dict[WAVEFORM_DATA];
        expect(["OW", "OB"]).toContain(element.vr);
        expect(new Uint8Array(element.Value[0])).toEqual(waveform);
        expect(invalidVrCalls(validationLog.warn)).toHaveLength(0);
        expect(invalidVrCalls(validationLog.error)).toHaveLength(0);
    });
});
