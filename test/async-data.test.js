import fs from "fs";
import { AsyncDicomReader } from "../src/AsyncDicomReader";
import { DicomMetadataListener } from "../src/utilities/DicomMetadataListener";
import { TagHex } from "../src/constants/dicom";
import { getTestDataset } from "./testUtils.js";

describe("AsyncDicomReader", () => {
    test("DICOM part 10 complete listener uncompressed", async () => {
        const buffer = fs.readFileSync("test/sample-dicom.dcm");
        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();

        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();

        const { meta, dict } = await reader.readFile({ listener });
        expect(meta[TagHex.TransferSyntaxUID].Value[0]).toBe(
            "1.2.840.10008.1.2"
        );
        expect(dict[TagHex.Rows].Value[0]).toBe(512);
    });

    test("async reader listen test uncompressed", async () => {
        // Don't use such a small chunk size in production, but doing it
        // here stresses the buffer stream read, and so does using an odd
        // prime
        const stream = fs.createReadStream("test/sample-dicom.dcm", {
            highWaterMark: 37
        });
        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();

        const readPromise = reader.stream.fromAsyncStream(stream);
        let isRead = false;
        readPromise.then(() => {
            isRead = true;
        });

        const { meta, dict } = await reader.readFile({ listener });
        expect(isRead).toBe(true);
        expect(meta[TagHex.TransferSyntaxUID].Value[0]).toBe(
            "1.2.840.10008.1.2"
        );
        expect(dict[TagHex.Rows].Value[0]).toBe(512);
        expect(dict[TagHex.PixelData].Value[0].byteLength).toBe(512 * 512 * 2);
    });

    test("async reader listen test compressed", async () => {
        const reader = new AsyncDicomReader();

        const stream = fs.createReadStream("test/sample-op.dcm", {
            highWaterMark: 256
        });
        reader.stream.fromAsyncStream(stream);

        const { meta, dict } = await reader.readFile();
        expect(meta[TagHex.TransferSyntaxUID].Value[0]).toBe(
            "1.2.840.10008.1.2.4.70"
        );
        expect(dict[TagHex.Rows].Value[0]).toBe(1536);
        const [pixelData] = dict[TagHex.PixelData].Value;
        expect(pixelData).toBeInstanceOf(ArrayBuffer);
        expect(pixelData.byteLength).toBe(101304);
    });

    test("compressed multiframe data test", async () => {
        const url =
            "https://github.com/dcmjs-org/data/releases/download/binary-parsing-stressors/multiframe-ultrasound.dcm";
        const dcmPath = await getTestDataset(url, "multiframe-ultrasound.dcm");
        const reader = new AsyncDicomReader();

        const stream = fs.createReadStream(dcmPath, {
            highWaterMark: 4001
        });
        reader.stream.fromAsyncStream(stream);

        const { meta, dict } = await reader.readFile();
        expect(meta[TagHex.TransferSyntaxUID].Value[0]).toBe(
            "1.2.840.10008.1.2.4.50"
        );
        const numFrames = dict[TagHex.NumberOfFrames].Value[0];
        expect(numFrames).toBe(29);
        const frames = dict[TagHex.PixelData].Value;
        expect(frames.length).toBe(numFrames);
    });

    test("compressed fragmented multiframe data test", async () => {
        const url =
            "https://github.com/dcmjs-org/data/releases/download/encapsulation/encapsulation-fragment-multiframe.dcm";
        const dcmPath = await getTestDataset(
            url,
            "encapsulation-fragment-multiframe-b.dcm"
        );
        const reader = new AsyncDicomReader();

        const stream = fs.createReadStream(dcmPath, {
            highWaterMark: 4001
        });
        reader.stream.fromAsyncStream(stream);

        const { meta, dict } = await reader.readFile();
        expect(meta[TagHex.TransferSyntaxUID].Value[0]).toBe(
            "1.2.840.10008.1.2.4.90"
        );
        const numFrames = dict[TagHex.NumberOfFrames].Value[0];
        expect(numFrames).toBe(2);
        const frames = dict[TagHex.PixelData].Value;
        expect(frames.length).toBe(numFrames);
        expect(frames[0].length).toBe(2);
        expect(frames[1].length).toBe(2);
    });
});
