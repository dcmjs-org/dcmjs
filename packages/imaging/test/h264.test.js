// test/h264.test.js
//
// h264TransferSyntaxUID: the AVC profile/level → DICOM transfer syntax
// mapping (Supplement 225). Extracted from the video package's mp4Info suite
// when this function moved to @dcmjs-org/imaging.

import { h264TransferSyntaxUID } from "../src/h264.js";

const H264_HIGH_41 = "1.2.840.10008.1.2.4.102.1";
const H264_HIGH_42 = "1.2.840.10008.1.2.4.104.1";

describe("h264TransferSyntaxUID", () => {
    it("maps Baseline/Main/High ≤ 4.1 to the Level 4.1 fragmentable syntax", () => {
        expect(h264TransferSyntaxUID(66, 30)).toBe(H264_HIGH_41);
        expect(h264TransferSyntaxUID(77, 40)).toBe(H264_HIGH_41);
        expect(h264TransferSyntaxUID(100, 41)).toBe(H264_HIGH_41);
    });

    it("maps level 4.2 to the Level 4.2 fragmentable syntax", () => {
        expect(h264TransferSyntaxUID(100, 42)).toBe(H264_HIGH_42);
        expect(h264TransferSyntaxUID(66, 42)).toBe(H264_HIGH_42);
    });

    it("returns null beyond the defined envelope", () => {
        expect(h264TransferSyntaxUID(100, 51)).toBeNull(); // level 5.1
        expect(h264TransferSyntaxUID(110, 42)).toBeNull(); // High-10
        expect(h264TransferSyntaxUID(244, 41)).toBeNull(); // High-444
    });
});
