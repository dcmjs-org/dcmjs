import fs from "fs";
import { AsyncDicomReader } from '../src/AsyncDicomReader';
import { DicomMetadataListener } from '../src/utilities/DicomMetadataListener';

describe("AsyncDicomReader", () => {
    test("DICOM part 10 complete listener uncompressed", async () => {
        const buffer = fs.readFileSync("test/sample-dicom.dcm");
        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();

        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();

        const { fmi, dict } = await reader.readFile({ listener });
        expect(fmi["00020010"].Value[0]).toBe("1.2.840.10008.1.2");
        expect(dict["00280010"].Value[0]).toBe(512);
    });

    test("async reader listen test", async () => {
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

        const { fmi, dict } = await reader.readFile({ listener });
        expect(isRead).toBe(true);
        expect(fmi["00020010"].Value[0]).toBe("1.2.840.10008.1.2");
        expect(dict["00280010"].Value[0]).toBe(512);
    });
});
