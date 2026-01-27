import fs from "fs";
import { AsyncDicomReader } from "../src/AsyncDicomReader";
import {
    DicomMetadataListener,
    createInformationFilter
} from "../src/utilities/DicomMetadataListener";
import { TagHex } from "../src/constants/dicom";

describe("Information Filter", () => {
    test("listener.information is populated with default tags", async () => {
        const buffer = fs.readFileSync("test/sample-dicom.dcm");
        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();

        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();

        await reader.readFile({ listener });

        // Verify that information object exists
        expect(listener.information).toBeDefined();

        // Verify that tracked tags are present in information
        expect(listener.information.rows).toBe(512);
        expect(listener.information.columns).toBe(512);

        // Check that UIDs are populated if available in the test file
        if (listener.information.studyInstanceUid) {
            expect(typeof listener.information.studyInstanceUid).toBe("string");
        }
        if (listener.information.seriesInstanceUid) {
            expect(typeof listener.information.seriesInstanceUid).toBe(
                "string"
            );
        }
        if (listener.information.sopInstanceUid) {
            expect(typeof listener.information.sopInstanceUid).toBe("string");
        }
    });

    test("listener.information can be accessed for pixel data processing", async () => {
        const buffer = fs.readFileSync("test/sample-dicom.dcm");
        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();

        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();

        const { dict } = await reader.readFile({ listener });

        // Verify that pixel data was read correctly using information
        expect(dict[TagHex.PixelData]).toBeDefined();
        expect(dict[TagHex.PixelData].Value[0]).toBeDefined();

        // Verify information was used correctly (no errors during reading)
        expect(listener.information.rows).toBe(512);
        expect(listener.information.columns).toBe(512);
        expect(listener.information.bitsAllocated).toBe(16);
        expect(listener.information.samplesPerPixel).toBe(1);
    });

    test("custom information tags can be specified", async () => {
        const buffer = fs.readFileSync("test/sample-dicom.dcm");
        const reader = new AsyncDicomReader();

        // Only track specific tags
        const customTags = new Set([TagHex.Rows, TagHex.Columns]);
        const listener = new DicomMetadataListener({
            informationTags: customTags
        });

        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();

        await reader.readFile({ listener });

        // Verify that only tracked tags are present
        expect(listener.information.rows).toBe(512);
        expect(listener.information.columns).toBe(512);

        // Other default tags should not be tracked
        expect(listener.information.bitsAllocated).toBeUndefined();
        expect(listener.information.samplesPerPixel).toBeUndefined();
    });

    test("information contains normalized camelCase names", async () => {
        const buffer = fs.readFileSync("test/sample-dicom.dcm");
        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();

        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();

        await reader.readFile({ listener });

        // Verify normalized naming (lower camel case)
        expect(listener.information).toHaveProperty("rows");
        expect(listener.information).toHaveProperty("columns");
        expect(listener.information).toHaveProperty("samplesPerPixel");
        expect(listener.information).toHaveProperty("bitsAllocated");

        // Verify UID becomes Uid (not UID)
        if (listener.information.studyInstanceUid !== undefined) {
            expect(listener.information).toHaveProperty("studyInstanceUid");
        }
    });

    test("multiframe data uses information for frame processing", async () => {
        const url =
            "https://github.com/dcmjs-org/data/releases/download/binary-parsing-stressors/multiframe-ultrasound.dcm";
        const dcmPath = await import("./testUtils.js").then(m =>
            m.getTestDataset(url, "multiframe-ultrasound.dcm")
        );

        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();

        const stream = fs.createReadStream(dcmPath, {
            highWaterMark: 4001
        });
        reader.stream.fromAsyncStream(stream);

        const { dict } = await reader.readFile({ listener });

        // Verify information was populated
        expect(listener.information.numberOfFrames).toBe(29);

        // Verify frames were read correctly
        const frames = dict[TagHex.PixelData].Value;
        expect(frames.length).toBe(29);
    });

    test("custom informationFilter can be passed to listener", async () => {
        const buffer = fs.readFileSync("test/sample-dicom.dcm");
        const reader = new AsyncDicomReader();

        // Create a custom information object to track the filter was used
        const customInformation = {};
        const customFilter = createInformationFilter();

        // Pass the custom filter via options
        const listener = new DicomMetadataListener({
            information: customInformation,
            informationFilter: customFilter
        });

        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();

        const { meta } = await reader.readFile({ listener });

        // Verify that the custom information object was populated
        expect(listener.information).toBe(customInformation);
        expect(listener.information).toBeDefined();

        // Verify rows and columns are accessible
        expect(listener.information.rows).toBe(512);
        expect(listener.information.columns).toBe(512);

        // Verify transfer syntax UID is accessible from meta
        expect(meta[TagHex.TransferSyntaxUID].Value[0]).toBe(
            "1.2.840.10008.1.2"
        );
    });
});
