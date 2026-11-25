import { NMImageNormalizer, SEGImageNormalizer } from "../src/normalizers.js";
import Segmentation from "../src/derivations/Segmentation.js";

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

it.each([true, false])(
    "derives a SEG from one frame of a multiframe instance that has no functional groups (includeSliceSpacing %s)",
    includeSliceSpacing => {
        const normalizer = new SEGImageNormalizer([
            buildSingleFrameOfMultiframeInstance()
        ]);
        normalizer.normalize();
        const multiframe = normalizer.dataset;

        // PixelData holds 1 frame, but the declared NumberOfFrames stays.
        expect(multiframe.NumberOfFrames).toBe(4);
        expect(multiframe.SharedFunctionalGroupsSequence).toMatchObject({
            PlaneOrientationSequence: {
                ImageOrientationPatient: [1, 0, 0, 0, 1, 0]
            },
            PixelMeasuresSequence: { PixelSpacing: [1, 1] }
        });
        expect(multiframe.PerFrameFunctionalGroupsSequence).toHaveLength(4);
        multiframe.PerFrameFunctionalGroupsSequence.forEach((item, i) => {
            expect(item.PlanePositionSequence).toEqual({
                ImagePositionPatient: [0, 0, 0]
            });
            expect(item.FrameContentSequence.InStackPositionNumber).toBe(i + 1);
        });
        const [first, second] = multiframe.PerFrameFunctionalGroupsSequence;
        expect(first.PlanePositionSequence.ImagePositionPatient).not.toBe(
            second.PlanePositionSequence.ImagePositionPatient
        );

        const seg = new Segmentation([multiframe], { includeSliceSpacing });
        seg.setNumberOfFrames(1);
        seg.addSegmentFromLabelmap(
            {
                SegmentLabel: "1",
                SegmentAlgorithmType: "MANUAL",
                SegmentedPropertyCategoryCodeSequence: {},
                SegmentedPropertyTypeCodeSequence: {}
            },
            [new Uint8Array([1, 0, 0, 1])],
            1,
            [1]
        );
        expect(
            seg.dataset.PerFrameFunctionalGroupsSequence[0]
                .PlanePositionSequence
        ).toEqual({ ImagePositionPatient: [0, 0, 0] });
    }
);

it.each([2, 10])(
    "keeps NumberOfFrames 8 for encapsulated PixelData with %s fragments",
    fragments => {
        const dataset = buildSingleFrameOfMultiframeInstance();
        dataset.NumberOfFrames = 8;
        dataset.PixelData = Array.from(
            { length: fragments },
            () => new ArrayBuffer(10)
        );
        const normalizer = new NMImageNormalizer([dataset]);
        normalizer.normalize();

        expect(normalizer.dataset.NumberOfFrames).toBe(8);
        expect(
            normalizer.dataset.PerFrameFunctionalGroupsSequence
        ).toHaveLength(8);
    }
);

it("treats an empty per-frame sequence as missing for NumberOfFrames 8", () => {
    const dataset = buildSingleFrameOfMultiframeInstance();
    dataset.NumberOfFrames = 8;
    dataset.PerFrameFunctionalGroupsSequence = [];
    const normalizer = new NMImageNormalizer([dataset]);
    normalizer.normalize();

    const perFrame = normalizer.dataset.PerFrameFunctionalGroupsSequence;
    expect(perFrame).toHaveLength(8);
    perFrame.forEach(item => {
        expect(item.PlanePositionSequence).toBeDefined();
        expect(item.FrameContentSequence).toBeDefined();
    });
    expect(perFrame[0].PlanePositionSequence.ImagePositionPatient).not.toBe(
        perFrame[1].PlanePositionSequence.ImagePositionPatient
    );
});

it("gives an object, not an array, as the per-frame item for NumberOfFrames 1", () => {
    const dataset = buildSingleFrameOfMultiframeInstance();
    dataset.NumberOfFrames = 1;
    dataset.SharedFunctionalGroupsSequence = {};
    const normalizer = new SEGImageNormalizer([dataset]);
    normalizer.normalize();

    const perFrame = normalizer.dataset.PerFrameFunctionalGroupsSequence;
    expect(Array.isArray(perFrame[0])).toBe(false);
    expect(perFrame[0].FrameContentSequence).toBeDefined();
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
