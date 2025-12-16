import fs from "fs";
import { AsyncDicomReader } from "../src/AsyncDicomReader";
import { DicomMetadataListener } from "../src/utilities/DicomMetadataListener";
import { TagHex } from "../src/constants/dicom";

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
});
