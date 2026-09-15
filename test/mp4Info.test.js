// test/mp4Info.test.js
//
// parseMp4Info: box-walk geometry/timing extraction and the H.264 → DICOM
// transfer syntax mapping — over synthesized MP4s (makeTinyMp4), so no
// binary fixtures are committed.

import { parseMp4Info, h264TransferSyntaxUID } from "../src/image/mp4Info.js";
import { makeTinyMp4 } from "./utils/makeTinyMp4.js";

const H264_HIGH_41 = "1.2.840.10008.1.2.4.102.1";
const H264_HIGH_42 = "1.2.840.10008.1.2.4.104.1";

describe("parseMp4Info", () => {
    it("reads geometry, frame count, and frame rate (moov at end)", async () => {
        const mp4 = makeTinyMp4();
        const info = await parseMp4Info(mp4);
        expect(info.columns).toBe(64);
        expect(info.rows).toBe(48);
        expect(info.numberOfFrames).toBe(12);
        expect(info.frameRate).toBe(60);
        expect(info.cineRate).toBe(60);
        expect(info.frameTime).toBe("16.666667");
        expect(info.codec).toBe("avc1");
        expect(info.profileIdc).toBe(100);
        expect(info.levelIdc).toBe(42);
        expect(info.transferSyntaxUID).toBe(H264_HIGH_42);
        expect(info.mp4ByteLength).toBe(mp4.byteLength);
    });

    it("parses the moov-first (web-optimized) layout identically", async () => {
        const atEnd = await parseMp4Info(makeTinyMp4());
        const first = await parseMp4Info(makeTinyMp4({ moovFirst: true }));
        expect(first.rows).toBe(atEnd.rows);
        expect(first.columns).toBe(atEnd.columns);
        expect(first.numberOfFrames).toBe(atEnd.numberOfFrames);
        expect(first.transferSyntaxUID).toBe(atEnd.transferSyntaxUID);
    });

    it("accepts a random-access reader and reads only what it needs", async () => {
        const mp4 = makeTinyMp4({ mdatLength: 100001 });
        const reads = [];
        const reader = {
            size: mp4.byteLength,
            read: (offset, length) => {
                reads.push(length);
                return Promise.resolve(mp4.subarray(offset, offset + length));
            }
        };
        const info = await parseMp4Info(reader);
        expect(info.columns).toBe(64);
        // Header probes plus one moov read — never the whole file.
        const largest = Math.max(...reads);
        expect(largest).toBeLessThan(mp4.byteLength / 10);
    });

    it("rejects non-MP4 input with a corrective error", async () => {
        const notMp4 = new Uint8Array(64).fill(0x41);
        await expect(parseMp4Info(notMp4)).rejects.toThrow(/not an MP4/);
    });

    it("rejects an MP4 with no moov box", async () => {
        const mp4 = makeTinyMp4();
        // ftyp + mdat only: cut the file before the trailing moov.
        const mdatEnd = 24 + 8 + 1001; // ftyp(24) + mdat header + payload
        await expect(parseMp4Info(mp4.subarray(0, mdatEnd))).rejects.toThrow(
            /no moov/
        );
    });

    it("maps unsupported codecs/levels to a null transfer syntax", async () => {
        const level51 = await parseMp4Info(makeTinyMp4({ levelIdc: 51 }));
        expect(level51.transferSyntaxUID).toBeNull();

        const hevc = await parseMp4Info(makeTinyMp4({ codec: "hev1" }));
        expect(hevc.transferSyntaxUID).toBeNull();
        expect(hevc.profileIdc).toBeNull();
    });
});

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
