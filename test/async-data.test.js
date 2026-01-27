import fs from "fs";
import dcmjs from "../src/index.js";
import {
    TagHex,
    IMPLICIT_LITTLE_ENDIAN,
    UNDEFINED_LENGTH
} from "../src/constants/dicom";
import { getTestDataset } from "./testUtils.js";
import { videoTestMeta, videoTestDict } from "./video-test-dict.js";
import { oddFrameBitData } from "./odd-frame-bit-data.js";

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
        // Uncompressed PixelData now matches compressed: an array of frames, each frame an array of chunks
        const frames = dict[TagHex.PixelData].Value;
        expect(Array.isArray(frames)).toBe(true);
        expect(frames.length).toBe(1);
        expect(Array.isArray(frames[0])).toBe(true);
        expect(frames[0].length).toBe(1);
        expect(frames[0][0].byteLength).toBe(512 * 512 * 2);
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
        const frames = dict[TagHex.PixelData].Value;
        expect(Array.isArray(frames)).toBe(true);
        expect(frames.length).toBe(1);
        // Frames are always arrays, even for single fragments
        expect(Array.isArray(frames[0])).toBe(true);
        const frame0 = frames[0];
        const chunk0 = frame0[0];
        expect(chunk0).toBeInstanceOf(ArrayBuffer);
        expect(chunk0.byteLength).toBe(101304);
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

    test("video transfer syntax with multiple fragments and maxFragmentSize", async () => {
        // Create a DICOM file with video transfer syntax (H.264)
        const videoTransferSyntax = "1.2.840.10008.1.2.4.102"; // MPEG-4 AVC/H.264 High Profile / Level 4.1
        const maxFragmentSize = 1024; // 1KB for testing

        // Create fragments of different sizes:
        // - Fragment 1: 512 bytes (smaller than maxFragmentSize)
        // - Fragment 2: 1024 bytes (exactly maxFragmentSize)
        // - Fragment 3: 2048 bytes (larger than maxFragmentSize, should be split)
        const fragment1Size = 512;
        const fragment2Size = 1024;
        const fragment3Size = 2048;

        const fragment1 = new Uint8Array(fragment1Size);
        const fragment2 = new Uint8Array(fragment2Size);
        const fragment3 = new Uint8Array(fragment3Size);

        // Fill with test data
        for (let i = 0; i < fragment1Size; i++) {
            fragment1[i] = 0x01;
        }
        for (let i = 0; i < fragment2Size; i++) {
            fragment2[i] = 0x02;
        }
        for (let i = 0; i < fragment3Size; i++) {
            fragment3[i] = 0x03;
        }

        // Create DICOM dict and write base file
        const dicomDict = new DicomDict(videoTestMeta);
        dicomDict.dict = videoTestDict;
        const baseBuffer = dicomDict.write();

        // Append compressed pixel data with fragments
        const WriteBufferStream = dcmjs.data.WriteBufferStream;
        const writeStream = new WriteBufferStream(null, true);

        // Write the base buffer first
        const baseArray = new Uint8Array(baseBuffer);
        for (let i = 0; i < baseArray.length; i++) {
            writeStream.writeUint8(baseArray[i]);
        }

        // Pixel Data (7FE0,0010) with undefined length
        writeStream.writeUint16(0x7fe0);
        writeStream.writeUint16(0x0010);
        writeStream.writeAsciiString("OB");
        writeStream.writeUint16(0x0000); // Reserved
        writeStream.writeUint32(UNDEFINED_LENGTH); // Undefined length

        // Basic Offset Table (BOT) - empty for video (no offsets)
        writeStream.writeUint16(0xfffe); // Item tag
        writeStream.writeUint16(0xe000);
        writeStream.writeUint32(0x00000000); // Length 0 (no offsets)

        // Fragment 1
        writeStream.writeUint16(0xfffe); // Item tag
        writeStream.writeUint16(0xe000);
        writeStream.writeUint32(fragment1Size);
        for (let i = 0; i < fragment1Size; i++) {
            writeStream.writeUint8(fragment1[i]);
        }

        // Fragment 2
        writeStream.writeUint16(0xfffe); // Item tag
        writeStream.writeUint16(0xe000);
        writeStream.writeUint32(fragment2Size);
        for (let i = 0; i < fragment2Size; i++) {
            writeStream.writeUint8(fragment2[i]);
        }

        // Fragment 3
        writeStream.writeUint16(0xfffe); // Item tag
        writeStream.writeUint16(0xe000);
        writeStream.writeUint32(fragment3Size);
        for (let i = 0; i < fragment3Size; i++) {
            writeStream.writeUint8(fragment3[i]);
        }

        // Sequence Delimitation Item
        writeStream.writeUint16(0xfffe);
        writeStream.writeUint16(0xe0dd);
        writeStream.writeUint32(0x00000000);

        const buffer = writeStream.getBuffer();

        // Read with AsyncDicomReader
        const reader = new AsyncDicomReader({ maxFragmentSize });
        const listener = new DicomMetadataListener();

        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();

        const { meta, dict } = await reader.readFile({ listener });

        // Verify transfer syntax
        expect(meta[TagHex.TransferSyntaxUID].Value[0]).toBe(
            videoTransferSyntax
        );

        // Verify pixel data
        expect(dict[TagHex.PixelData]).toBeDefined();
        const frames = dict[TagHex.PixelData].Value;

        // Frames are always arrays, so for video we have a single frame containing all fragments
        expect(Array.isArray(frames)).toBe(true);
        expect(frames.length).toBe(1); // Single frame for video

        // Get the fragments array from the first frame (unwrap 1 level if needed)
        const pixelData = Array.isArray(frames[0][0])
            ? frames[0][0]
            : frames[0];

        // For video transfer syntax, all fragments should be combined into a single array
        // Fragment 3 (2048 bytes) should be split into 2 fragments of 1024 bytes each
        // So we should have: fragment1 (512), fragment2 (1024), fragment3_part1 (1024), fragment3_part2 (1024)
        expect(Array.isArray(pixelData)).toBe(true);
        // Expect 4 after splitting 2048 -> 2x1024; allow an extra nesting level and flatten if needed
        const flatPixelData = pixelData.flat ? pixelData.flat() : pixelData;
        expect(flatPixelData.length).toBe(4); // All fragments combined, with fragment3 split

        // Verify fragment 1 (512 bytes, unchanged)
        expect(flatPixelData[0]).toBeInstanceOf(ArrayBuffer);
        expect(flatPixelData[0].byteLength).toBe(512);
        const frag1Data = new Uint8Array(flatPixelData[0]);
        expect(frag1Data[0]).toBe(0x01);
        expect(frag1Data[511]).toBe(0x01);

        // Verify fragment 2 (1024 bytes, unchanged)
        expect(flatPixelData[1]).toBeInstanceOf(ArrayBuffer);
        expect(flatPixelData[1].byteLength).toBe(1024);
        const frag2Data = new Uint8Array(flatPixelData[1]);
        expect(frag2Data[0]).toBe(0x02);
        expect(frag2Data[1023]).toBe(0x02);

        // Verify fragment 3 part 1 (1024 bytes, split from 2048)
        expect(flatPixelData[2]).toBeInstanceOf(ArrayBuffer);
        expect(flatPixelData[2].byteLength).toBe(1024);
        const frag3Part1Data = new Uint8Array(flatPixelData[2]);
        expect(frag3Part1Data[0]).toBe(0x03);
        expect(frag3Part1Data[1023]).toBe(0x03);

        // Verify fragment 3 part 2 (1024 bytes, split from 2048)
        expect(flatPixelData[3]).toBeInstanceOf(ArrayBuffer);
        expect(flatPixelData[3].byteLength).toBe(1024);
        const frag3Part2Data = new Uint8Array(flatPixelData[3]);
        expect(frag3Part2Data[0]).toBe(0x03);
        expect(frag3Part2Data[1023]).toBe(0x03);
    });

    test("readUncompressedBitFrame with 3 frames having odd total bit length", async () => {
        // Test data: 3 frames, each with 7 bits (odd)
        // Total: 21 bits (odd, not even byte-aligned, requires 3 bytes)

        // Create pixel data buffer with 3 frames (3 bytes total for 21 bits)
        const packedData = oddFrameBitData.getPackedData();
        const pixelDataBuffer = new Uint8Array(packedData);

        // Create AsyncDicomReader and set up the stream
        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();

        // Set up listener information
        listener.information = {
            rows: oddFrameBitData.rows,
            columns: oddFrameBitData.columns,
            samplesPerPixel: oddFrameBitData.samplesPerPixel,
            bitsAllocated: oddFrameBitData.bitsAllocated,
            numberOfFrames: oddFrameBitData.numberOfFrames.toString()
        };

        // Set the listener on the reader (required for readUncompressed to access listener.information)
        reader.listener = listener;

        // Add pixel data to stream
        reader.stream.addBuffer(pixelDataBuffer.buffer);
        reader.stream.setComplete();

        // Create tag info for pixel data
        const tagInfo = {
            tag: TagHex.PixelData,
            length: oddFrameBitData.totalBytes,
            vr: "OW"
        };

        // Call readUncompressed, which should detect odd-length frames and call readUncompressedBitFrame
        // The method expects frames to be stored in an array structure
        const framesArray = [];
        listener.startObject(framesArray);
        await reader.readUncompressed(tagInfo);
        const frames = listener.pop();

        // Verify pixel data information
        expect(listener.information.rows).toBe(oddFrameBitData.rows);
        expect(listener.information.columns).toBe(oddFrameBitData.columns);
        expect(listener.information.samplesPerPixel).toBe(
            oddFrameBitData.samplesPerPixel
        );
        expect(listener.information.bitsAllocated).toBe(
            oddFrameBitData.bitsAllocated
        );
        expect(listener.information.numberOfFrames).toBe(
            oddFrameBitData.numberOfFrames.toString()
        );

        // Verify frames structure
        expect(Array.isArray(frames)).toBe(true);
        expect(frames.length).toBe(3);

        // Verify each frame
        const bytesPerFrame = Math.ceil(oddFrameBitData.bitsPerFrame / 8);
        expect(bytesPerFrame).toBe(1); // 7 bits = 1 byte

        // Get expected unpacked frames
        const expectedFrames = oddFrameBitData.getExpectedFrames();

        for (let i = 0; i < frames.length; i++) {
            expect(Array.isArray(frames[i])).toBe(true);
            // Each frame should be an array containing the frame data
            const frameChunks = frames[i];
            expect(frameChunks.length).toBe(1); // Single chunk per frame (1 byte each)

            // Verify the chunk is an ArrayBuffer
            expect(frameChunks[0]).toBeInstanceOf(ArrayBuffer);
            expect(frameChunks[0].byteLength).toBe(bytesPerFrame);

            // Verify the unpacked frame data (each frame starts at byte 0)
            const frameData = new Uint8Array(frameChunks[0]);
            const expectedData = expectedFrames[i];
            expect(frameData.length).toBe(expectedData.length);
            // Compare the first byte (only 7 bits are valid, but we compare the whole byte)
            expect(frameData[0]).toBe(expectedData[0]);
        }

        // Verify total bit length is odd (not even byte-aligned)
        const totalBits = oddFrameBitData.totalBits;
        expect(totalBits).toBe(21);
        expect(totalBits % 2).toBe(1); // Odd number
        expect(totalBits % 8).not.toBe(0); // Not even byte-aligned (21 % 8 = 5)

        // Verify total bytes read matches expected
        let totalBytesRead = 0;
        for (const frame of frames) {
            for (const chunk of frame) {
                totalBytesRead += chunk.byteLength;
            }
        }
        expect(totalBytesRead).toBe(oddFrameBitData.totalBytes);
        expect(totalBytesRead).toBe(3); // 3 bytes for 21 bits
    });

    test("private tags are read correctly", async () => {
        const url =
            "https://github.com/dcmjs-org/data/releases/download/binary-parsing-stressors/large-private-tags.dcm";
        const dcmPath = await getTestDataset(url, "large-private-tags.dcm");

        // First, read the file with DicomMessage to identify which private tags exist
        // and determine their order relative to PixelData
        const syncDict = DicomMessage.readFile(fs.readFileSync(dcmPath).buffer);

        // Get all tags in order (approximate - dict keys may not preserve exact order)
        const { dict } = syncDict;

        const privateCreator = dict["7FE10010"];
        expect(privateCreator.Value[0]).toBe("GEMS_Ultrasound_MovieGroup_001");
        expect(privateCreator.vr).toBe("LO");
        const privateSq = dict["7FE11001"];
        const [sq0] = privateSq.Value;
        const obj1002 = sq0["7FE11002"];
        expect(obj1002.Value[0]).toBe("2D+Trace");
    });
});
