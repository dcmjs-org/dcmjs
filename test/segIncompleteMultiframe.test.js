import { SEGImageNormalizer } from "../src/normalizers";

const ENHANCED_MR_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.4.1";

function buildSingleFrameOfMultiframeInstance() {
    const rows = 2;
    const columns = 2;
    const pixels = new Uint16Array(rows * columns);
    pixels.fill(7);
    return {
        SOPClassUID: ENHANCED_MR_SOP_CLASS_UID,
        SOPInstanceUID: "1.2.826.0.1.3680043.8.498.12345",
        StudyInstanceUID: "1.2.826.0.1.3680043.8.498.1",
        SeriesInstanceUID: "1.2.826.0.1.3680043.8.498.2",
        FrameOfReferenceUID: "1.2.826.0.1.3680043.8.498.3",
        Modality: "MR",
        PatientID: "1",
        PatientName: "Test^Patient",
        NumberOfFrames: 4,
        Rows: rows,
        Columns: columns,
        ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
        ImagePositionPatient: [0, 0, 0],
        PixelSpacing: [1, 1],
        BitsAllocated: 16,
        PixelRepresentation: 0,
        PixelData: pixels,
        _vrMap: { PixelData: "OW" },
        _meta: {}
    };
}

it("normalizes a single frame taken from a multiframe instance that has no functional group sequences", () => {
    const dataset = buildSingleFrameOfMultiframeInstance();
    const normalizer = new SEGImageNormalizer([dataset]);

    expect(() => normalizer.normalize()).not.toThrow();

    const multiframe = normalizer.dataset;
    expect(multiframe).toBeDefined();
    expect(multiframe.SharedFunctionalGroupsSequence).toBeDefined();
    expect(
        multiframe.SharedFunctionalGroupsSequence
            .PixelValueTransformationSequence
    ).toBeDefined();
    expect(multiframe.PerFrameFunctionalGroupsSequence).toBeDefined();
    expect(
        multiframe.PerFrameFunctionalGroupsSequence[0].FrameContentSequence
    ).toBeDefined();
});

it("keeps a complete multiframe dataset unchanged", () => {
    const dataset = buildSingleFrameOfMultiframeInstance();
    dataset.SharedFunctionalGroupsSequence = {
        PixelMeasuresSequence: { PixelSpacing: [1, 1] }
    };
    dataset.PerFrameFunctionalGroupsSequence = [
        { PlanePositionSequence: { ImagePositionPatient: [0, 0, 0] } }
    ];
    const normalizer = new SEGImageNormalizer([dataset]);
    normalizer.normalize();

    const multiframe = normalizer.dataset;
    expect(
        multiframe.SharedFunctionalGroupsSequence.PixelMeasuresSequence
    ).toEqual({ PixelSpacing: [1, 1] });
    expect(
        multiframe.SharedFunctionalGroupsSequence
            .PixelValueTransformationSequence
    ).toBeDefined();
    expect(
        multiframe.PerFrameFunctionalGroupsSequence[0].PlanePositionSequence
    ).toEqual({ ImagePositionPatient: [0, 0, 0] });
    expect(
        multiframe.PerFrameFunctionalGroupsSequence[0].FrameContentSequence
    ).toBeDefined();
});
