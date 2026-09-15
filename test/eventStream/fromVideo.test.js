// test/eventStream/fromVideo.test.js
//
// DicomEventStream.fromVideo / fromVideoStream / toVideo: MP4 → event
// stream → Part 10 → back to the byte-identical MP4. Also pins the
// (7FE0,0003) UV element on the wire (the uint64 total length that makes
// pad-byte-exact extraction possible) and the streaming fragment layout
// StreamingPart10Writer produces.

import dcmjs from "../../src/index.js";
import { makeTinyMp4 } from "../utils/makeTinyMp4.js";

const { DicomEventStream, StreamingPart10Writer } = dcmjs.eventStream;
const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const H264_HIGH_42 = "1.2.840.10008.1.2.4.104.1";

/** Find a byte pattern in a Uint8Array; -1 when absent. */
function indexOfBytes(haystack, needle, from = 0) {
    outer: for (let i = from; i <= haystack.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) {
                continue outer;
            }
        }
        return i;
    }
    return -1;
}

describe("DicomEventStream.fromVideo", () => {
    it("round-trips MP4 → Part 10 → MP4 byte-identically", async () => {
        const mp4 = makeTinyMp4(); // odd payload → exercises the pad byte
        const part10 = await DicomEventStream.fromVideo(mp4, {
            PatientName: "DOE^JANE",
            fragmentBytes: 512
        }).toPart10();

        const readBack = DicomMessage.readFile(part10);
        const dataset = DicomMetaDictionary.naturalizeDataset(readBack.dict);
        const meta = DicomMetaDictionary.naturalizeDataset(readBack.meta);
        expect(meta.TransferSyntaxUID).toBe(H264_HIGH_42);
        expect(dataset.Modality).toBe("XC");
        expect([].concat(dataset.PatientName)[0]).toEqual({
            Alphabetic: "DOE^JANE"
        });

        const { bytes, declaredLength } = await DicomEventStream.fromPart10(
            part10
        ).toVideo();
        expect(declaredLength).toBe(mp4.byteLength);
        expect(Buffer.compare(Buffer.from(bytes), Buffer.from(mp4))).toBe(0);
    });

    it("round-trips through the streaming reader too", async () => {
        const mp4 = makeTinyMp4();
        const part10 = await DicomEventStream.fromVideo(mp4, {
            fragmentBytes: 256
        }).toPart10();
        const { bytes } = await DicomEventStream.fromPart10Stream(
            new Uint8Array(part10)
        ).toVideo();
        expect(Buffer.compare(Buffer.from(bytes), Buffer.from(mp4))).toBe(0);
    });

    it("writes (7FE0,0003) as a UV uint64 carrying the exact stream length", async () => {
        const mp4 = makeTinyMp4();
        const part10 = new Uint8Array(
            await DicomEventStream.fromVideo(mp4).toPart10()
        );

        // Explicit VR long-form header: tag E0 7F 03 00, "UV", 2 reserved,
        // 32-bit length 8.
        const header = [
            0xe0, 0x7f, 0x03, 0x00, 0x55, 0x56, 0x00, 0x00, 8, 0, 0, 0
        ];
        const at = indexOfBytes(part10, header);
        expect(at).toBeGreaterThan(-1);
        const view = new DataView(
            part10.buffer,
            part10.byteOffset + at + header.length,
            8
        );
        expect(view.getBigUint64(0, true)).toBe(BigInt(mp4.byteLength));

        // and the naturalized read surfaces it as a BigInt
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(part10.buffer).dict
        );
        const value = Array.isArray(
            dataset.EncapsulatedPixelDataValueTotalLength
        )
            ? dataset.EncapsulatedPixelDataValueTotalLength[0]
            : dataset.EncapsulatedPixelDataValueTotalLength;
        expect(BigInt(value)).toBe(BigInt(mp4.byteLength));
    });

    it("streams fragments through StreamingPart10Writer with the Sup 225 layout", async () => {
        const mp4 = makeTinyMp4({ mdatLength: 2001 });
        const reader = {
            size: mp4.byteLength,
            read: (offset, length) =>
                Promise.resolve(mp4.subarray(offset, offset + length))
        };
        const writer = new StreamingPart10Writer(); // accumulate mode
        await DicomEventStream.fromVideoStream(reader, {
            fragmentBytes: 1024
        }).process(writer);
        const bytes = new Uint8Array(writer.toArrayBuffer());

        // Pixel Data header: (7FE0,0010) OB, undefined length.
        const pixelHeader = [
            0xe0, 0x7f, 0x10, 0x00, 0x4f, 0x42, 0x00, 0x00, 0xff, 0xff, 0xff,
            0xff
        ];
        const at = indexOfBytes(bytes, pixelHeader);
        expect(at).toBeGreaterThan(-1);
        const view = new DataView(bytes.buffer, bytes.byteOffset);

        // Empty Basic Offset Table item.
        let cursor = at + pixelHeader.length;
        expect(view.getUint16(cursor, true)).toBe(0xfffe);
        expect(view.getUint16(cursor + 2, true)).toBe(0xe000);
        expect(view.getUint32(cursor + 4, true)).toBe(0);
        cursor += 8;

        // Fragment items: even lengths, total = payload + 1 pad byte.
        const fragmentLengths = [];
        while (
            view.getUint16(cursor, true) === 0xfffe &&
            view.getUint16(cursor + 2, true) === 0xe000
        ) {
            const length = view.getUint32(cursor + 4, true);
            fragmentLengths.push(length);
            cursor += 8 + length;
        }
        expect(view.getUint16(cursor, true)).toBe(0xfffe);
        expect(view.getUint16(cursor + 2, true)).toBe(0xe0dd);
        expect(view.getUint32(cursor + 4, true)).toBe(0);

        expect(fragmentLengths.length).toBe(Math.ceil(mp4.byteLength / 1024));
        for (const length of fragmentLengths) {
            expect(length % 2).toBe(0);
        }
        const totalWritten = fragmentLengths.reduce((n, l) => n + l, 0);
        const pad = mp4.byteLength % 2;
        expect(totalWritten).toBe(mp4.byteLength + pad);

        // and the streamed file reads back to the identical MP4
        const { bytes: recovered } = await DicomEventStream.fromPart10(
            bytes.buffer
        ).toVideo();
        expect(Buffer.compare(Buffer.from(recovered), Buffer.from(mp4))).toBe(
            0
        );
    });

    it("emits exactly one endDataSet, after the pixel data", async () => {
        const events = [];
        class RecordingListener extends dcmjs.eventStream.EventStreamListener {
            _baseEndDataSet() {
                events.push(["endDataSet", []]);
            }
            _baseStartBinary(opts) {
                events.push(["startBinary", [opts]]);
            }
            _baseEndBinary() {
                events.push(["endBinary", []]);
            }
        }
        await DicomEventStream.fromVideo(makeTinyMp4()).process(
            new RecordingListener()
        );

        const ends = events.filter(([type]) => type === "endDataSet");
        expect(ends.length).toBe(1);
        expect(events[events.length - 1][0]).toBe("endDataSet");
        // FileMetaInformationVersion emits a plain binary in the meta group;
        // exactly one ENCAPSULATED binary follows — the pixel data.
        const encapsulatedStarts = events.filter(
            ([type, args]) => type === "startBinary" && args[0]?.encapsulated
        );
        expect(encapsulatedStarts.length).toBe(1);
    });

    it("honors backpressure between fragments", async () => {
        const mp4 = makeTinyMp4({ mdatLength: 4096 });
        let drains = 0;
        const writer = new StreamingPart10Writer();
        writer.setDrain(() => {
            drains++;
            return Promise.resolve();
        });
        await DicomEventStream.fromVideo(mp4, {
            fragmentBytes: 1024
        }).process(writer);
        // one drain checkpoint per fragment, plus the dataset-element ones
        expect(drains).toBeGreaterThanOrEqual(Math.ceil(mp4.byteLength / 1024));
    });

    it("rejects unsupported codecs with the transcode corrective error", async () => {
        await expect(
            DicomEventStream.fromVideo(makeTinyMp4({ levelIdc: 51 })).toPart10()
        ).rejects.toThrow(/ffmpeg/);
    });

    it("toVideo rejects a non-video stream with a corrective error", async () => {
        const pdfMagic = new TextEncoder().encode("%PDF-1.4\n%tiny\n");
        const events = DicomEventStream.fromPdf(pdfMagic, {
            PatientName: "FOX^JANE"
        });
        await expect(events.toVideo()).rejects.toThrow(
            /not an encapsulated video/
        );
    });
});
