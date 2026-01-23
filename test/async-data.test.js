import fs from "fs";
import dcmjs from "../src/index.js";
import { TagHex, IMPLICIT_LITTLE_ENDIAN } from "../src/constants/dicom";
import { getTestDataset } from "./testUtils.js";

const { DicomDict, DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;
const { DicomMetadataListener } = dcmjs.utilities;

// Ensure DicomMessage is set on DicomDict
DicomDict.setDicomMessageClass(DicomMessage);

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

    test("raw LEI encoded file test", async () => {
        const buffer = fs.readFileSync("test/sample-op.lei");
        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();

        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();

        const { meta, dict } = await reader.readFile({ listener });

        // Raw LEI files have no meta header
        expect(meta).toEqual({});

        // Verify transfer syntax was detected as LEI
        expect(listener.information.transferSyntaxUid).toBe(
            "1.2.840.10008.1.2"
        );

        // Verify we can read some basic tags from the dataset
        expect(dict).toBeDefined();
        expect(Object.keys(dict).length).toBeGreaterThan(0);

        // Verify we can read Rows if present
        if (dict[TagHex.Rows]) {
            expect(dict[TagHex.Rows].Value[0]).toBeDefined();
        }
    });

    describe("LEI object data tests", () => {
        let leiBuffer;
        let parsedDict;

        beforeAll(async () => {
            // Create an LEI object containing a sequence with a code value
            const dicomDict = new DicomDict({
                [TagHex.TransferSyntaxUID]: {
                    vr: "UI",
                    Value: [IMPLICIT_LITTLE_ENDIAN]
                }
            });

            // Add a sequence (Concept Code Sequence - 0040A043) with a single item
            // containing a Code Value (00080100)
            dicomDict.dict["0040A043"] = {
                vr: "SQ",
                Value: [
                    {
                        "00080100": {
                            vr: "SH",
                            Value: ["TEST123"]
                        }
                    }
                ]
            };

            // Add Per-frame Functional Groups Sequence (52009229) with two frames
            // Each frame contains a Functional Group Sequence (52009230) with one functional group
            dicomDict.dict["52009229"] = {
                vr: "SQ",
                Value: [
                    {
                        // Frame 1: Contains a Functional Group Sequence with one functional group
                        52009230: {
                            vr: "SQ",
                            Value: [
                                {
                                    // Functional group containing a code value
                                    "00080100": {
                                        vr: "SH",
                                        Value: ["FRAME1_CODE"]
                                    }
                                }
                            ]
                        }
                    },
                    {
                        // Frame 2: Contains a Functional Group Sequence with one functional group
                        52009230: {
                            vr: "SQ",
                            Value: [
                                {
                                    // Functional group containing a code value
                                    "00080100": {
                                        vr: "SH",
                                        Value: ["FRAME2_CODE"]
                                    }
                                }
                            ]
                        }
                    }
                ]
            };

            // Write to buffer (this creates a Part 10 file)
            leiBuffer = dicomDict.write();

            // Parse with AsyncDicomReader
            const reader = new AsyncDicomReader();
            const listener = new DicomMetadataListener();

            reader.stream.addBuffer(leiBuffer);
            reader.stream.setComplete();

            const result = await reader.readFile({ listener });
            parsedDict = result.dict;
        });

        test("sequence has a single object containing the code value", () => {
            // Check that the sequence exists
            expect(parsedDict["0040A043"]).toBeDefined();
            expect(parsedDict["0040A043"].vr).toBe("SQ");
            expect(parsedDict["0040A043"].Value).toBeDefined();
            expect(Array.isArray(parsedDict["0040A043"].Value)).toBe(true);

            // Check that the sequence has a single object
            expect(parsedDict["0040A043"].Value.length).toBe(1);

            // Check that the single object contains the code value
            const sequenceItem = parsedDict["0040A043"].Value[0];
            expect(sequenceItem).toBeDefined();
            expect(sequenceItem["00080100"]).toBeDefined();
            expect(sequenceItem["00080100"].Value).toBeDefined();
            expect(sequenceItem["00080100"].Value[0]).toBe("TEST123");
        });

        test("per-frame functional groups sequence has two frames with functional groups", () => {
            // Check that the Per-frame Functional Groups Sequence exists
            expect(parsedDict["52009229"]).toBeDefined();
            expect(parsedDict["52009229"].vr).toBe("SQ");
            expect(parsedDict["52009229"].Value).toBeDefined();
            expect(Array.isArray(parsedDict["52009229"].Value)).toBe(true);

            // Check that the sequence has two frames
            expect(parsedDict["52009229"].Value.length).toBe(2);

            // Check Frame 1
            const frame1 = parsedDict["52009229"].Value[0];
            expect(frame1).toBeDefined();
            expect(frame1["52009230"]).toBeDefined(); // Functional Group Sequence
            expect(frame1["52009230"].vr).toBe("SQ");
            expect(Array.isArray(frame1["52009230"].Value)).toBe(true);
            expect(frame1["52009230"].Value.length).toBe(1); // Single functional group

            // Check functional group in Frame 1
            const functionalGroup1 = frame1["52009230"].Value[0];
            expect(functionalGroup1).toBeDefined();
            expect(functionalGroup1["00080100"]).toBeDefined();
            expect(functionalGroup1["00080100"].Value).toBeDefined();
            expect(functionalGroup1["00080100"].Value[0]).toBe("FRAME1_CODE");

            // Check Frame 2
            const frame2 = parsedDict["52009229"].Value[1];
            expect(frame2).toBeDefined();
            expect(frame2["52009230"]).toBeDefined(); // Functional Group Sequence
            expect(frame2["52009230"].vr).toBe("SQ");
            expect(Array.isArray(frame2["52009230"].Value)).toBe(true);
            expect(frame2["52009230"].Value.length).toBe(1); // Single functional group

            // Check functional group in Frame 2
            const functionalGroup2 = frame2["52009230"].Value[0];
            expect(functionalGroup2).toBeDefined();
            expect(functionalGroup2["00080100"]).toBeDefined();
            expect(functionalGroup2["00080100"].Value).toBeDefined();
            expect(functionalGroup2["00080100"].Value[0]).toBe("FRAME2_CODE");
        });
    });
});
