/**
 * frameDataset: the view of one frame of an enhanced multi-frame dataset.
 * See docs/specs/naturalized-dataset.md (NAT-U-FRAME). Each test names its
 * category: "API" (the API must do this) or "UX" (the user experience must
 * have this).
 */
import dcmjs from "../../src/index.js";
import { frameDataset } from "@dcmjs-org/core";

const { DicomMetaDictionary } = dcmjs.data;

const sq = (...items) => ({ vr: "SQ", Value: items });
const ds = (...values) => ({ vr: "DS", Value: values });
const lo = value => ({ vr: "LO", Value: [value] });
const privateItem = (creator, value) => ({
    "00290010": lo(creator),
    "00291001": lo(value)
});

function perFrame(frame) {
    const groups = {
        // PlanePositionSequence
        "00209113": sq({ "00200032": ds(0, 0, frame) }),
        // FrameContentSequence, with a private block in the macro item
        "00209111": sq({
            "00209157": { vr: "UL", Value: [frame] },
            ...privateItem("ACME", `frame${frame}`)
        }),
        // a private block directly in the functional group item
        "00310010": lo("DIRECT"),
        "00311001": lo("skip"),
        // DerivationImageSequence item with a SOPInstanceUID: reference data
        "00089124": sq({
            "00080018": { vr: "UI", Value: ["1.2.3"] },
            "00200052": { vr: "UI", Value: ["9.9.9"] }
        })
    };
    if (frame === 1) {
        // PixelMeasuresSequence
        groups["00289110"] = sq({ "00180050": ds(3) });
    }
    return groups;
}

function multiFrame() {
    return DicomMetaDictionary.naturalizeDataset({
        "00280008": { vr: "IS", Value: [2] },
        "00180050": ds(1),
        ...privateItem("ACME", "root"),
        52009229: sq({ "00289110": sq({ "00180050": ds(2) }) }),
        52009230: sq(perFrame(1), perFrame(2))
    });
}

describe("frameDataset", () => {
    it("API: per-frame over shared over root, and each frame reads its own values", () => {
        const dataset = multiFrame();
        const frame1 = frameDataset(dataset, 1);
        const frame2 = frameDataset(dataset, 2);

        expect(frame1.SliceThickness).toBe(3);
        expect(frame2.SliceThickness).toBe(2);
        expect(frame1.ImagePositionPatient).toEqual([0, 0, 1]);
        expect(frame2.ImagePositionPatient).toEqual([0, 0, 2]);
        expect(frameDataset(dataset).ImagePositionPatient).toEqual([0, 0, 1]);
    });

    it("UX: a one-item sequence in the view keeps [0] and length", () => {
        const frame = frameDataset(multiFrame(), 1);
        const { PlanePositionSequence } =
            frame.PerFrameFunctionalGroupsSequence[0];

        expect(PlanePositionSequence[0]).toBe(PlanePositionSequence);
        expect(PlanePositionSequence.length).toBe(1);
        expect(frame.SharedFunctionalGroupsSequence.length).toBe(1);
    });

    it("API: the hex alias of a private block reads the block of each frame", () => {
        const dataset = multiFrame();

        expect(dataset["00291001"]).toEqual(["root"]);
        expect(frameDataset(dataset, 1)["00291001"]).toEqual(["frame1"]);
        expect(frameDataset(dataset, 2)["00291001"]).toEqual(["frame2"]);
        // a private block directly in the functional group item is skipped
        expect(frameDataset(dataset, 1)["00311001"]).toBeUndefined();
    });

    it("API: an item with a SOPInstanceUID is skipped", () => {
        const frame = frameDataset(multiFrame(), 1);

        expect(frame.SOPInstanceUID).toBeUndefined();
        expect(frame.FrameOfReferenceUID).toBeUndefined();
    });

    it("API: the input keeps its keys and values; the cache is one hidden key", () => {
        const dataset = multiFrame();
        const before = JSON.stringify(dataset);
        const keys = Object.getOwnPropertyNames(dataset);

        const frame = frameDataset(dataset, 2);

        expect(frameDataset(dataset, 2)).toBe(frame);
        expect(JSON.stringify(dataset)).toBe(before);
        expect(Object.getOwnPropertyNames(dataset)).toEqual([
            ...keys,
            "_frameDatasets"
        ]);
        expect(Object.keys(dataset)).not.toContain("_frameDatasets");
        expect(dataset["00291001"]).toEqual(["root"]);
        delete dataset._frameDatasets;
        expect(frameDataset(dataset, 2)).not.toBe(frame);
    });

    it("API: denaturalizeDataset of a view writes the functional group attributes of the frame", () => {
        const frame = frameDataset(multiFrame(), 1);
        const dict = DicomMetaDictionary.denaturalizeDataset(frame);

        expect(Object.keys(dict).sort()).toEqual(
            ["00180050", "00200032", "00209157", "00290010", "00291001"].sort()
        );
        expect(dict["00291001"]).toEqual(lo("frame1"));
    });

    it("API: NumberOfFrames below 2 gives the same object", () => {
        const dataset = multiFrame();
        dataset.NumberOfFrames = 1;

        expect(frameDataset(dataset, 1)).toBe(dataset);
    });

    it("UX: the option functions add computed attributes and runtime properties", () => {
        const dataset = multiFrame();
        // a caller fallback, as for an RTDOSE GridFrameOffsetVector
        const options = {
            frameAttributes: (view, { frameNumber }) => ({
                ImagePositionPatient: [0, 0, 10 * frameNumber],
                SliceThickness: view.SliceThickness
            }),
            frameProperties: (view, { frameNumber }) => ({ frameNumber })
        };
        const frame = frameDataset(dataset, 2, options);

        expect(frame.ImagePositionPatient).toEqual([0, 0, 20]);
        expect(frame.SliceThickness).toBe(2);
        expect(frame.frameNumber).toBe(2);
        expect(Object.keys(frame)).not.toContain("frameNumber");
        expect(frameDataset(dataset, 2, options)).toBe(frame);
        expect(frameDataset(dataset, 2).frameNumber).toBeUndefined();
    });

    it("API: dcmjs.data exports frameDataset", () => {
        expect(dcmjs.data.frameDataset).toBe(frameDataset);
    });
});
