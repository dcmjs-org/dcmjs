// test/buildImageDataset.test.js
//
// buildImageDataset: decoded pixels -> a conformant naturalized image
// dataset, with the options of encapsulate. The load-bearing rules: the
// geometry comes from the pixels, and derivedFrom yields a DERIVED\SECONDARY
// result with a new SOPInstanceUID.

import {
    combineBases,
    DATA_LEVELS,
    extendDataLevels,
    log,
    validationLog
} from "@dcmjs-org/core";
import {
    buildImageDataset,
    derivedImageAttributes,
    derivedImageBase,
    imageBase,
    SECONDARY_CAPTURE_SOP_CLASS_UID
} from "../src/index.js";

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

describe("createInstance options", () => {
    test("instance and dataLevel place the image in an existing series", () => {
        const source = {
            PatientID: "P1",
            StudyInstanceUID: "2.25.1",
            SeriesInstanceUID: "2.25.2",
            SOPClassUID: SECONDARY_CAPTURE_SOP_CLASS_UID,
            SOPInstanceUID: "2.25.3",
            Modality: "OT"
        };
        const dataset = buildImageDataset(grayPixels(), {
            instance: source,
            dataLevel: "series",
            predecessor: true
        });
        expect(dataset.PatientID).toBe("P1");
        expect(dataset.StudyInstanceUID).toBe("2.25.1");
        expect(dataset.SeriesInstanceUID).toBe("2.25.2");
        expect(dataset.SOPInstanceUID).not.toBe("2.25.3");
        expect(
            dataset.PredecessorDocumentsSequence[0].ReferencedSeriesSequence[0]
                .ReferencedSOPSequence[0].ReferencedSOPInstanceUID
        ).toBe("2.25.3");
        expect(dataset.instance).toBeUndefined();
        expect(dataset.dataLevel).toBeUndefined();
    });
});

describe("defaults (no instance)", () => {
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
    // API: geometry that a custom level inherits from the prior instance
    // does not reach the result.
    test("the geometry of the prior instance does not reach the result", () => {
        const dataset = buildImageDataset(grayPixels(4, 4), {
            instance: {
                StudyInstanceUID: "1.2.3.4",
                SeriesInstanceUID: "1.2.3.4.1",
                Rows: 999,
                NumberOfFrames: 7,
                PlanarConfiguration: 1
            },
            dataLevel: "series",
            levels: extendDataLevels(DATA_LEVELS, {
                series: ["Rows", "NumberOfFrames", "PlanarConfiguration"]
            })
        });
        expect(dataset.Rows).toBe(4);
        expect(dataset.NumberOfFrames).toBeUndefined();
        expect(dataset.PlanarConfiguration).toBeUndefined();
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

describe("overrides", () => {
    // API: an override beats the value inherited from instance.
    test("keyword overrides beat instance", () => {
        const dataset = buildImageDataset(grayPixels(), {
            instance: { PatientID: "998877", StudyInstanceUID: "1.2.3.4" },
            PatientID: "22446688",
            PatientName: "FOX^JANE"
        });
        expect(dataset.StudyInstanceUID).toBe("1.2.3.4");
        expect(dataset.PatientID).toBe("22446688");
        expect(dataset.PatientName).toBe("FOX^JANE");
    });
});

describe("derived-instance conformance", () => {
    const source = {
        SOPClassUID: MR_SOP_CLASS_UID,
        SOPInstanceUID: SOURCE_SOP_INSTANCE_UID,
        Modality: "MR",
        StudyInstanceUID: "1.2.3.4"
    };

    // User experience: a derived image references its source and never
    // reuses the source identity.
    test("derivedFrom gives a DERIVED\\SECONDARY image that references the source", () => {
        const dataset = buildImageDataset(grayPixels(), {
            instance: source,
            derivedFrom: source
        });
        expect(dataset.StudyInstanceUID).toBe("1.2.3.4");
        expect(dataset.SOPInstanceUID).not.toBe(SOURCE_SOP_INSTANCE_UID);
        expect(dataset.SOPClassUID).toBe(SECONDARY_CAPTURE_SOP_CLASS_UID);
        expect(dataset.ImageType).toEqual(["DERIVED", "SECONDARY"]);
        expect(dataset.SourceImageSequence).toEqual([
            {
                ReferencedSOPClassUID: MR_SOP_CLASS_UID,
                ReferencedSOPInstanceUID: SOURCE_SOP_INSTANCE_UID
            }
        ]);
        expect(dataset.LossyImageCompression).toBe("01");
    });

    // API: an override ImageType wins over the derived default.
    test("an override ImageType wins with derivedFrom", () => {
        const dataset = buildImageDataset(grayPixels(), {
            derivedFrom: [source],
            ImageType: ["DERIVED", "PRIMARY"]
        });
        expect(dataset.ImageType).toEqual(["DERIVED", "PRIMARY"]);
        expect(dataset.SourceImageSequence).toHaveLength(1);
    });

    // API: the lossy option sets the Lossy Image Compression attributes.
    test("lossy: false marks a lossless derivation", () => {
        const dataset = buildImageDataset(grayPixels(), {
            derivedFrom: source,
            lossy: false
        });
        expect(dataset.LossyImageCompression).toBe("00");
        // A lossy source stays lossy (PS3.3 C.7.6.1.1.5).
        expect(
            buildImageDataset(grayPixels(), {
                derivedFrom: { ...source, LossyImageCompression: "01" },
                lossy: false
            }).LossyImageCompression
        ).toBe("01");
    });

    // API: ImageType is a base value, so a custom base sets it, and
    // derivedImageBase composed after it replaces it.
    test("a custom base sets ImageType, and derivedImageBase replaces it", () => {
        const base = combineBases(imageBase, {
            ImageType: ["DERIVED", "PRIMARY"]
        });
        expect(
            buildImageDataset(grayPixels(), { baseDicom: base }).ImageType
        ).toEqual(["DERIVED", "PRIMARY"]);
        const derived = buildImageDataset(grayPixels(), {
            baseDicom: combineBases(base, derivedImageBase(source))
        });
        expect(derived.ImageType).toEqual(["DERIVED", "SECONDARY"]);
        expect(derived.SourceImageSequence).toHaveLength(1);
    });

    // API: a lossy object sets the method and the ratio.
    test("lossy detail carries method and ratio", () => {
        const dataset = buildImageDataset(grayPixels(), {
            derivedFrom: source,
            lossy: { method: "ISO_10918_1", ratio: 8 }
        });
        expect(dataset.LossyImageCompressionMethod).toBe("ISO_10918_1");
        expect(dataset.LossyImageCompressionRatio).toBe(8);
    });

    // API: an override SOPInstanceUID always wins.
    test("explicit SOPInstanceUID override is respected", () => {
        const dataset = buildImageDataset(grayPixels(), {
            instance: source,
            derivedFrom: source,
            SOPInstanceUID: "2.25.42"
        });
        expect(dataset.SOPInstanceUID).toBe("2.25.42");
    });
});

describe("derivedImageAttributes", () => {
    // API: one SourceImageSequence item for each source, and a clear error
    // for a source without its identity.
    test("references each partial instance, and names a missing keyword", () => {
        const attributes = derivedImageAttributes([
            { SOPClassUID: MR_SOP_CLASS_UID, SOPInstanceUID: "2.25.1" },
            { SOPClassUID: MR_SOP_CLASS_UID, SOPInstanceUID: "2.25.2" }
        ]);
        expect(attributes.ImageType).toEqual(["DERIVED", "SECONDARY"]);
        expect(
            attributes.SourceImageSequence.map(
                item => item.ReferencedSOPInstanceUID
            )
        ).toEqual(["2.25.1", "2.25.2"]);
        expect(() =>
            derivedImageAttributes([{ SOPClassUID: MR_SOP_CLASS_UID }])
        ).toThrow(/derivedFrom\[0\] is missing SOPInstanceUID/);
        expect(() => derivedImageAttributes([])).toThrow(
            /derivedFrom needs at least one instance/
        );
        expect(() => derivedImageBase([])).toThrow(
            /derivedFrom needs at least one instance/
        );
    });

    // API: the lossy steps of a source stay in the history (PS3.3
    // C.7.6.1.1.5), before the step of this derivation.
    test("keeps the lossy compression history of a lossy source", () => {
        const attributes = derivedImageAttributes(
            {
                SOPClassUID: MR_SOP_CLASS_UID,
                SOPInstanceUID: "2.25.1",
                LossyImageCompression: "01",
                LossyImageCompressionMethod: "ISO_14495_1",
                LossyImageCompressionRatio: 5
            },
            { lossy: { method: "ISO_10918_1", ratio: 10 } }
        );
        expect([
            attributes.LossyImageCompressionMethod,
            attributes.LossyImageCompressionRatio
        ]).toEqual([
            ["ISO_14495_1", "ISO_10918_1"],
            [5, 10]
        ]);

        // A source method without a ratio: the ratios cannot pair by
        // position, so the result has no ratio (IMG-USR-3).
        const warn = jest.spyOn(log, "warn").mockImplementation(() => {});
        const unpaired = derivedImageAttributes(
            {
                SOPClassUID: MR_SOP_CLASS_UID,
                SOPInstanceUID: "2.25.1",
                LossyImageCompression: "01",
                LossyImageCompressionMethod: "ISO_15444_1"
            },
            { lossy: { method: "ISO_10918_1", ratio: 8 } }
        );
        expect([
            unpaired.LossyImageCompressionMethod,
            unpaired.LossyImageCompressionRatio,
            warn.mock.calls.length
        ]).toEqual([["ISO_15444_1", "ISO_10918_1"], undefined, 1]);
        warn.mockRestore();
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
