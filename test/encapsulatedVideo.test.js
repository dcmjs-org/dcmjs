// test/encapsulatedVideo.test.js
//
// buildVideoDataset / encapsulateVideo / extractEncapsulatedVideo — the
// buffered video encapsulation layer. Element values are pinned against the
// Supplement 225 reference fixture's dataset (large-files
// build_dicom_video.py) so the JS builder and the independent Python oracle
// agree on the instance shape.

import {
    buildVideoDataset,
    encapsulateVideo,
    extractEncapsulatedVideo,
    normalizeFragmentBytes,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES
} from "../src/encapsulated/encapsulatedVideo.js";
import { parseMp4Info } from "../src/image/mp4Info.js";
import { makeTinyMp4 } from "./utils/makeTinyMp4.js";

const H264_HIGH_42 = "1.2.840.10008.1.2.4.104.1";

describe("buildVideoDataset", () => {
    let info;
    beforeAll(async () => {
        info = await parseMp4Info(makeTinyMp4());
    });

    it("mirrors the Supplement 225 reference element list", () => {
        const dataset = buildVideoDataset(info, {
            PatientName: "DOE^JANE",
            PatientID: "JD-001"
        });
        expect(dataset.SOPClassUID).toBe(VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID);
        expect(dataset.Modality).toBe("XC");
        expect(dataset.PatientName).toBe("DOE^JANE");
        expect(dataset.PatientID).toBe("JD-001");
        expect(dataset.CineRate).toBe(60);
        expect(dataset.FrameTime).toBe("16.666667");
        expect(dataset.SamplesPerPixel).toBe(3);
        expect(dataset.PhotometricInterpretation).toBe("YBR_PARTIAL_420");
        expect(dataset.PlanarConfiguration).toBe(0);
        expect(dataset.NumberOfFrames).toBe(12);
        expect(dataset.Rows).toBe(48);
        expect(dataset.Columns).toBe(64);
        expect(dataset.BitsAllocated).toBe(8);
        expect(dataset.BitsStored).toBe(8);
        expect(dataset.HighBit).toBe(7);
        expect(dataset.PixelRepresentation).toBe(0);
        expect(dataset.LossyImageCompression).toBe("01");
        expect(dataset.EncapsulatedPixelDataValueTotalLength).toBe(
            BigInt(info.mp4ByteLength)
        );
        expect(dataset._meta.TransferSyntaxUID.Value).toEqual([H264_HIGH_42]);
        expect(dataset._vrMap.PixelData).toBe("OB");
        expect(dataset.PixelData).toBeUndefined();
    });

    it("mints fresh UIDs and honors overrides", () => {
        const a = buildVideoDataset(info);
        const b = buildVideoDataset(info);
        expect(a.SOPInstanceUID).not.toBe(b.SOPInstanceUID);
        const pinned = buildVideoDataset(info, {
            StudyInstanceUID: "1.2.3.4",
            SeriesInstanceUID: "1.2.3.4.5"
        });
        expect(pinned.StudyInstanceUID).toBe("1.2.3.4");
        expect(pinned.SeriesInstanceUID).toBe("1.2.3.4.5");
    });

    it("throws the transcode corrective error for unsupported codecs", async () => {
        const hevcInfo = await parseMp4Info(makeTinyMp4({ codec: "hev1" }));
        expect(() => buildVideoDataset(hevcInfo)).toThrow(/ffmpeg/);
        expect(() => buildVideoDataset(hevcInfo)).toThrow(/hev1/);
    });
});

describe("normalizeFragmentBytes", () => {
    it("defaults and validates", () => {
        expect(normalizeFragmentBytes(undefined)).toBe(DEFAULT_FRAGMENT_BYTES);
        expect(normalizeFragmentBytes(4096)).toBe(4096);
        expect(() => normalizeFragmentBytes(4097)).toThrow(/even/);
        expect(() => normalizeFragmentBytes(0)).toThrow(/even integer/);
        expect(() => normalizeFragmentBytes(1.5)).toThrow(/even integer/);
        expect(() => normalizeFragmentBytes(0xfffffffe)).toThrow(
            /even integer/
        );
    });
});

describe("encapsulateVideo / extractEncapsulatedVideo", () => {
    it("splits the stream into fragment-sized slices", async () => {
        const mp4 = makeTinyMp4(); // 1001-byte odd mdat payload
        const dataset = await encapsulateVideo(mp4, { fragmentBytes: 1024 });
        expect(Array.isArray(dataset.PixelData)).toBe(true);
        const total = dataset.PixelData.reduce((n, f) => n + f.byteLength, 0);
        expect(total).toBe(mp4.byteLength);
        expect(dataset.PixelData.length).toBe(Math.ceil(mp4.byteLength / 1024));
        // every fragment but the last is exactly fragmentBytes
        for (const fragment of dataset.PixelData.slice(0, -1)) {
            expect(fragment.byteLength).toBe(1024);
        }
    });

    it("round-trips byte-identically, dropping the declared-length overrun", async () => {
        const mp4 = makeTinyMp4();
        const dataset = await encapsulateVideo(mp4, { fragmentBytes: 512 });
        // Simulate the Part 10 writer's pad byte on the odd final fragment.
        const last = new Uint8Array(
            dataset.PixelData[dataset.PixelData.length - 1]
        );
        const padded = new Uint8Array(last.byteLength + (last.byteLength % 2));
        padded.set(last);
        dataset.PixelData[dataset.PixelData.length - 1] = padded.buffer;

        const { bytes, transferSyntaxUID, declaredLength } =
            extractEncapsulatedVideo(dataset);
        expect(declaredLength).toBe(mp4.byteLength);
        expect(transferSyntaxUID).toBe(H264_HIGH_42);
        expect(bytes.byteLength).toBe(mp4.byteLength);
        expect(Buffer.compare(Buffer.from(bytes), Buffer.from(mp4))).toBe(0);
    });

    it("keeps everything and reports null when no total length is declared", async () => {
        const mp4 = makeTinyMp4({ mdatLength: 1000 }); // even → no padding
        const dataset = await encapsulateVideo(mp4);
        delete dataset.EncapsulatedPixelDataValueTotalLength;
        const { bytes, declaredLength } = extractEncapsulatedVideo(dataset);
        expect(declaredLength).toBeNull();
        expect(bytes.byteLength).toBe(mp4.byteLength);
    });

    it("rejects a non-video dataset with a corrective error", () => {
        expect(() =>
            extractEncapsulatedVideo({
                SOPClassUID: "1.2.840.10008.5.1.4.1.1.104.1", // Encapsulated PDF
                PatientName: "FOX^JANE",
                _meta: {
                    TransferSyntaxUID: { Value: ["1.2.840.10008.1.2.1"] }
                }
            })
        ).toThrow(/not an encapsulated video/);
    });
});
