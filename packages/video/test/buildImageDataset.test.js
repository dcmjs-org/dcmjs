// test/buildImageDataset.test.js
//
// buildImageDataset: decoded pixels + optional DICOM JSON / naturalized
// metadata -> a conformant naturalized image dataset. The load-bearing
// rules: actual geometry always wins over metadata claims, and identifying
// an original instance yields a DERIVED\SECONDARY result with a fresh
// SOPInstanceUID — original UIDs are never reused for rebuilt pixels.

import { validationLog } from "@dcmjs-org/core";
import {
    buildImageDataset,
    SECONDARY_CAPTURE_SOP_CLASS_UID
} from "../src/image/index.js";

validationLog.setLevel(5);

const MR_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.4";
const SOURCE_SOP_INSTANCE_UID = "2.25.111222333444";

function grayPixels(rows = 4, columns = 4) {
    return {
        pixels: new Uint8Array(rows * columns).fill(128),
        rows,
        columns
    };
}

describe("defaults (no metadata)", () => {
    const dataset = buildImageDataset(grayPixels());

    test("Secondary Capture scaffold with minted UIDs", () => {
        expect(dataset.SOPClassUID).toBe(SECONDARY_CAPTURE_SOP_CLASS_UID);
        expect(dataset.SOPInstanceUID).toMatch(/^2\.25\./);
        expect(dataset.StudyInstanceUID).toMatch(/^2\.25\./);
        expect(dataset.SeriesInstanceUID).toMatch(/^2\.25\./);
        expect(dataset.Modality).toBe("OT");
        expect(dataset.ConversionType).toBe("WSD");
        expect(dataset.ImageType).toEqual(["ORIGINAL", "PRIMARY"]);
    });

    test("Type-2 patient/study attributes are present and empty", () => {
        for (const keyword of [
            "PatientName",
            "PatientID",
            "PatientBirthDate",
            "PatientSex",
            "AccessionNumber",
            "StudyID"
        ]) {
            expect(dataset[keyword]).toBe("");
        }
    });

    test("geometry from the pixels; 8-bit mono", () => {
        expect(dataset.Rows).toBe(4);
        expect(dataset.Columns).toBe(4);
        expect(dataset.SamplesPerPixel).toBe(1);
        expect(dataset.PhotometricInterpretation).toBe("MONOCHROME2");
        expect(dataset.BitsAllocated).toBe(8);
        expect(dataset.BitsStored).toBe(8);
        expect(dataset.HighBit).toBe(7);
        expect(dataset.PixelRepresentation).toBe(0);
        expect(dataset.PlanarConfiguration).toBeUndefined();
        expect(dataset.NumberOfFrames).toBeUndefined();
        expect(dataset._vrMap.PixelData).toBe("OB");
        expect(dataset.PixelData.byteLength).toBe(16);
    });
});

describe("geometry always wins", () => {
    test("metadata claiming other geometry is overridden by the pixels", () => {
        const dataset = buildImageDataset(grayPixels(4, 4), {
            metadata: {
                Rows: 999,
                Columns: 999,
                BitsAllocated: 16,
                PhotometricInterpretation: "RGB"
            }
        });
        expect(dataset.Rows).toBe(4);
        expect(dataset.Columns).toBe(4);
        expect(dataset.BitsAllocated).toBe(8);
        expect(dataset.PhotometricInterpretation).toBe("MONOCHROME2");
    });

    test("geometry keyword override throws", () => {
        expect(() => buildImageDataset(grayPixels(), { Rows: 8 })).toThrow(
            /comes from the decoded image/
        );
    });
});

describe("16-bit and color", () => {
    test("Uint16Array yields 16-bit OW", () => {
        const dataset = buildImageDataset({
            pixels: new Uint16Array(4 * 4),
            rows: 4,
            columns: 4,
            bitsStored: 12
        });
        expect(dataset.BitsAllocated).toBe(16);
        expect(dataset.BitsStored).toBe(12);
        expect(dataset.HighBit).toBe(11);
        expect(dataset._vrMap.PixelData).toBe("OW");
    });

    test("Int16Array defaults to signed PixelRepresentation", () => {
        const dataset = buildImageDataset({
            pixels: new Int16Array(4),
            rows: 2,
            columns: 2
        });
        expect(dataset.PixelRepresentation).toBe(1);
    });

    test("RGB emits PlanarConfiguration", () => {
        const dataset = buildImageDataset({
            pixels: new Uint8Array(2 * 2 * 3),
            rows: 2,
            columns: 2,
            samplesPerPixel: 3
        });
        expect(dataset.PhotometricInterpretation).toBe("RGB");
        expect(dataset.PlanarConfiguration).toBe(0);
    });
});

describe("validation", () => {
    test("pixel length mismatch reports expected vs actual", () => {
        expect(() =>
            buildImageDataset({
                pixels: new Uint8Array(10),
                rows: 4,
                columns: 4
            })
        ).toThrow(/10 bytes but 4x4x1 at 8 bits needs 16/);
    });

    test("bitsAllocated / typed-array mismatch throws", () => {
        expect(() =>
            buildImageDataset({
                pixels: new Uint8Array(16),
                rows: 4,
                columns: 4,
                bitsAllocated: 16
            })
        ).toThrow(/does not match the 8-bit typed array/);
    });

    test("photometric vs samplesPerPixel mismatch throws", () => {
        expect(() =>
            buildImageDataset({
                pixels: new Uint8Array(16),
                rows: 4,
                columns: 4,
                photometricInterpretation: "RGB"
            })
        ).toThrow(/RGB requires samplesPerPixel 3/);
    });

    test("pixels plus encapsulated throws", () => {
        expect(() =>
            buildImageDataset(grayPixels(), {
                encapsulated: {
                    transferSyntaxUID: "1.2.840.10008.1.2.4.50",
                    frames: [new Uint8Array(4)]
                }
            })
        ).toThrow(/not both/);
    });
});

describe("metadata forms", () => {
    const tagKeyed = {
        "00080060": { vr: "CS", Value: ["MR"] },
        "00100010": { vr: "PN", Value: [{ Alphabetic: "DOE^JANE" }] },
        "00100020": { vr: "LO", Value: ["998877"] },
        "0020000D": { vr: "UI", Value: ["1.2.3.4"] }
    };

    test("DICOMweb JSON (tag-keyed) is naturalized", () => {
        const dataset = buildImageDataset(grayPixels(), {
            metadata: tagKeyed
        });
        expect(dataset.Modality).toBe("MR");
        expect(dataset.PatientID).toBe("998877");
        expect(dataset.StudyInstanceUID).toBe("1.2.3.4");
    });

    test("naturalized metadata is accepted identically", () => {
        const dataset = buildImageDataset(grayPixels(), {
            metadata: {
                Modality: "MR",
                PatientID: "998877",
                StudyInstanceUID: "1.2.3.4"
            }
        });
        expect(dataset.Modality).toBe("MR");
        expect(dataset.PatientID).toBe("998877");
        expect(dataset.StudyInstanceUID).toBe("1.2.3.4");
    });

    test("file meta keywords in metadata are stripped", () => {
        const dataset = buildImageDataset(grayPixels(), {
            metadata: {
                Modality: "MR",
                TransferSyntaxUID: "1.2.840.10008.1.2",
                MediaStorageSOPInstanceUID: "9.9.9"
            }
        });
        expect(dataset.TransferSyntaxUID).toBeUndefined();
        expect(dataset.MediaStorageSOPInstanceUID).toBeUndefined();
        expect(dataset._meta.TransferSyntaxUID.Value[0]).toBe(
            "1.2.840.10008.1.2.1"
        );
    });

    test("keyword overrides beat metadata", () => {
        const dataset = buildImageDataset(grayPixels(), {
            metadata: { PatientID: "998877" },
            PatientID: "22446688",
            PatientName: "FOX^JANE"
        });
        expect(dataset.PatientID).toBe("22446688");
        expect(dataset.PatientName).toBe("FOX^JANE");
    });
});

describe("derived-instance conformance", () => {
    const sourceMetadata = {
        SOPClassUID: MR_SOP_CLASS_UID,
        SOPInstanceUID: SOURCE_SOP_INSTANCE_UID,
        Modality: "MR",
        StudyInstanceUID: "1.2.3.4"
    };

    test("metadata identity triggers derived mode", () => {
        const dataset = buildImageDataset(grayPixels(), {
            metadata: sourceMetadata
        });
        expect(dataset.SOPInstanceUID).not.toBe(SOURCE_SOP_INSTANCE_UID);
        expect(dataset.SOPInstanceUID).toMatch(/^2\.25\./);
        expect(dataset.SOPClassUID).toBe(MR_SOP_CLASS_UID);
        expect(dataset.ImageType).toEqual(["DERIVED", "SECONDARY"]);
        expect(dataset.SourceImageSequence).toEqual([
            {
                ReferencedSOPClassUID: MR_SOP_CLASS_UID,
                ReferencedSOPInstanceUID: SOURCE_SOP_INSTANCE_UID
            }
        ]);
        expect(dataset.LossyImageCompression).toBe("01");
    });

    test("explicit derivedFrom object", () => {
        const dataset = buildImageDataset(grayPixels(), {
            derivedFrom: {
                sopClassUID: MR_SOP_CLASS_UID,
                sopInstanceUID: SOURCE_SOP_INSTANCE_UID
            }
        });
        expect(dataset.SourceImageSequence[0].ReferencedSOPInstanceUID).toBe(
            SOURCE_SOP_INSTANCE_UID
        );
        expect(dataset.LossyImageCompression).toBe("01");
    });

    test("lossy: false marks a lossless derivation", () => {
        const dataset = buildImageDataset(grayPixels(), {
            metadata: sourceMetadata,
            lossy: false
        });
        expect(dataset.LossyImageCompression).toBe("00");
    });

    test("lossy detail carries method and ratio", () => {
        const dataset = buildImageDataset(grayPixels(), {
            metadata: sourceMetadata,
            lossy: { method: "ISO_10918_1", ratio: 8 }
        });
        expect(dataset.LossyImageCompressionMethod).toBe("ISO_10918_1");
        expect(dataset.LossyImageCompressionRatio).toBe(8);
    });

    test("explicit SOPInstanceUID override is respected", () => {
        const dataset = buildImageDataset(grayPixels(), {
            metadata: sourceMetadata,
            SOPInstanceUID: "2.25.42"
        });
        expect(dataset.SOPInstanceUID).toBe("2.25.42");
    });
});

describe("encapsulated multi-frame (finding 10)", () => {
    const JPEG_BASELINE_TS = "1.2.840.10008.1.2.4.50";
    const frame = new Uint8Array([1, 2, 3, 4]);

    // Review finding 10: numberOfFrames came only from
    // decodedImage.numberOfFrames || 1 and the attribute was written only
    // when above 1 — three encapsulated fragments produced an instance
    // with no NumberOfFrames, so a conformant reader showed frame 1 and
    // frames 2 and 3 were unreachable.
    test("NumberOfFrames defaults to frames.length (finding 10)", () => {
        const dataset = buildImageDataset(
            { rows: 4, columns: 4 },
            {
                encapsulated: {
                    transferSyntaxUID: JPEG_BASELINE_TS,
                    frames: [frame, frame, frame]
                }
            }
        );
        expect(dataset.NumberOfFrames).toBe(3);
        expect(dataset.PixelData).toHaveLength(3);
    });

    // The reverse shape also passed unchecked: an explicit frame count
    // over a different number of fragments emitted the bogus claim.
    test("explicit numberOfFrames over a different fragment count throws (finding 10)", () => {
        expect(() =>
            buildImageDataset(
                { rows: 4, columns: 4, numberOfFrames: 7 },
                {
                    encapsulated: {
                        transferSyntaxUID: JPEG_BASELINE_TS,
                        frames: [frame, frame]
                    }
                }
            )
        ).toThrow(/does not match/);
    });

    test("a matching explicit count is accepted", () => {
        const dataset = buildImageDataset(
            { rows: 4, columns: 4, numberOfFrames: 2 },
            {
                encapsulated: {
                    transferSyntaxUID: JPEG_BASELINE_TS,
                    frames: [frame, frame]
                }
            }
        );
        expect(dataset.NumberOfFrames).toBe(2);
    });

    test("a single encapsulated frame still omits NumberOfFrames", () => {
        const dataset = buildImageDataset(
            { rows: 4, columns: 4 },
            {
                encapsulated: {
                    transferSyntaxUID: JPEG_BASELINE_TS,
                    frames: [frame]
                }
            }
        );
        expect(dataset.NumberOfFrames).toBeUndefined();
        expect(dataset.PixelData).toHaveLength(1);
    });
});
