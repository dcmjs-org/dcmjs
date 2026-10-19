// packages/dicomdir/test/mediaRoundTrip.long.test.js
//
// Opt-in long test: a full media round trip at video scale. Skipped unless
// DCMJS_LONG_TESTS is set, because it writes a multi-gigabyte file to the
// temp directory:
//
//     DCMJS_LONG_TESTS=1 pnpm jest packages/dicomdir
//
// What it pins: a DICOMDIR itself never contains pixel data — the records
// carry only paths and identity attributes, so writeDicomDir's cost does not
// depend on how big the referenced files are. The size-sensitive half of a
// media workflow is reading the referenced files back, and that must go
// through the bounded-memory streaming path. So this test builds the media
// a real burner would: a synthesized MPEG-4 (Sup 149/225-style) video
// instance far larger than any sane heap allocation, streamed to disk chunk
// by chunk, plus the DICOMDIR that indexes it. Then it reads the media back
// the way a workstation would: parse the DICOMDIR (ordinary Part 10, tiny),
// resolve ReferencedFileID to the file on disk, and stream-parse the huge
// file through fromPart10Stream with a listener that retains nothing —
// proving the indexed file is readable end-to-end at a size that would OOM
// any buffer-everything path. (The memory *bounds* of the streaming parser
// are pinned separately by the K5b tests in test/eventStream/.)
//
// Size defaults to 2 GiB of pixel fragments; override with
// DCMJS_LONG_TEST_VIDEO_BYTES (bytes, rounded down to whole fragments).

import fs from "fs";
import os from "os";
import path from "path";
import {
    fromPart10,
    fromPart10Stream,
    NaturalizedListener,
    EventStreamListener
} from "@dcmjs-org/parser";
import { writeDicomDir } from "../src/index.js";

const LONG = !!process.env.DCMJS_LONG_TESTS;
const longTest = LONG ? test : test.skip;

const MPEG4_TS = "1.2.840.10008.1.2.4.102"; // MPEG-4 AVC/H.264 HiP@4.1
const VIDEO_PHOTOGRAPHIC_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.77.4.1";
const SOP_INSTANCE_UID = "1.2.3.4.200";

const FRAGMENT_SIZE = 4 * 1024 * 1024; // 4 MiB per on-wire fragment
const DEFAULT_PIXEL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
const PIXEL_BYTES =
    Number(process.env.DCMJS_LONG_TEST_VIDEO_BYTES) || DEFAULT_PIXEL_BYTES;
const FRAGMENT_COUNT = Math.max(1, Math.floor(PIXEL_BYTES / FRAGMENT_SIZE));

// --- Minimal explicit-VR-little-endian byte emission -----------------------
// Just enough to synthesize the video file's envelope; the dicomdir package
// writer is NOT used for this file — the point is to index a file produced
// independently, as burned media would be.

function asciiEven(s) {
    const padded = s.length % 2 ? s + "\0" : s;
    const bytes = new Uint8Array(padded.length);
    for (let i = 0; i < padded.length; i++) {
        bytes[i] = padded.charCodeAt(i);
    }
    return bytes;
}

/** Short-form element (UI/CS/US/IS...): 2-byte length. */
function shortElem(group, element, vr, valueBytes) {
    const out = new Uint8Array(8 + valueBytes.length);
    const dv = new DataView(out.buffer);
    dv.setUint16(0, group, true);
    dv.setUint16(2, element, true);
    out[4] = vr.charCodeAt(0);
    out[5] = vr.charCodeAt(1);
    dv.setUint16(6, valueBytes.length, true);
    out.set(valueBytes, 8);
    return out;
}

/** Long-form element (OB/OW...): 2 reserved bytes + 4-byte length. */
function longElemHeader(group, element, vr, length) {
    const out = new Uint8Array(12);
    const dv = new DataView(out.buffer);
    dv.setUint16(0, group, true);
    dv.setUint16(2, element, true);
    out[4] = vr.charCodeAt(0);
    out[5] = vr.charCodeAt(1);
    dv.setUint32(8, length, true);
    return out;
}

function itemHeader(length) {
    const out = new Uint8Array(8);
    const dv = new DataView(out.buffer);
    dv.setUint16(0, 0xfffe, true);
    dv.setUint16(2, 0xe000, true);
    dv.setUint32(4, length, true);
    return out;
}

function sequenceDelimiter() {
    const out = new Uint8Array(8);
    const dv = new DataView(out.buffer);
    dv.setUint16(0, 0xfffe, true);
    dv.setUint16(2, 0xe0dd, true);
    dv.setUint32(4, 0, true);
    return out;
}

function us(n) {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, n, true);
    return out;
}

/**
 * Yield the complete Part 10 video file as chunks: preamble + DICM, FMI,
 * a small dataset, then FRAGMENT_COUNT encapsulated pixel fragments of
 * FRAGMENT_SIZE bytes each (fragment i filled with i & 0xff). Only one
 * fragment's bytes exist at a time.
 */
function* videoFileChunks() {
    const preamble = new Uint8Array(132);
    preamble.set(asciiEven("DICM"), 128);
    yield preamble;

    const fmiElements = [
        longElemHeader(0x0002, 0x0001, "OB", 2),
        new Uint8Array([0, 1]),
        shortElem(
            0x0002,
            0x0002,
            "UI",
            asciiEven(VIDEO_PHOTOGRAPHIC_SOP_CLASS)
        ),
        shortElem(0x0002, 0x0003, "UI", asciiEven(SOP_INSTANCE_UID)),
        shortElem(0x0002, 0x0010, "UI", asciiEven(MPEG4_TS))
    ];
    const fmiLength = fmiElements.reduce((n, b) => n + b.length, 0);
    const groupLength = new Uint8Array(4);
    new DataView(groupLength.buffer).setUint32(0, fmiLength, true);
    yield shortElem(0x0002, 0x0000, "UL", groupLength);
    yield* fmiElements;

    yield shortElem(
        0x0008,
        0x0016,
        "UI",
        asciiEven(VIDEO_PHOTOGRAPHIC_SOP_CLASS)
    );
    yield shortElem(0x0008, 0x0018, "UI", asciiEven(SOP_INSTANCE_UID));
    yield shortElem(0x0008, 0x0060, "CS", asciiEven("XC"));
    yield shortElem(0x0028, 0x0008, "IS", asciiEven(String(FRAGMENT_COUNT)));
    yield shortElem(0x0028, 0x0010, "US", us(512));
    yield shortElem(0x0028, 0x0011, "US", us(512));

    // (7FE0,0010) OB undefined length, empty Basic Offset Table, fragments.
    yield longElemHeader(0x7fe0, 0x0010, "OB", 0xffffffff);
    yield itemHeader(0);
    for (let i = 0; i < FRAGMENT_COUNT; i++) {
        yield itemHeader(FRAGMENT_SIZE);
        const fragment = new Uint8Array(FRAGMENT_SIZE);
        fragment.fill(i & 0xff);
        yield fragment;
    }
    yield sequenceDelimiter();
}

/** Stream the chunks to disk without accumulating them in memory. */
async function writeVideoFile(filePath) {
    const stream = fs.createWriteStream(filePath);
    let size = 0;
    for (const chunk of videoFileChunks()) {
        size += chunk.length;
        if (!stream.write(chunk)) {
            await new Promise(resolve => stream.once("drain", resolve));
        }
    }
    await new Promise((resolve, reject) => {
        stream.end(() => resolve());
        stream.on("error", reject);
    });
    return size;
}

/**
 * A listener that retains nothing: it counts the pixel-data fragment bytes
 * and remembers the identity values it sees. Binary events are scoped to
 * (7FE0,0010) because FileMetaInformationVersion is also OB and emits its
 * own (non-encapsulated) startBinary. If the huge file's pixel data were
 * ever materialized instead of streamed, jest's heap would not survive it.
 */
class CountingListener extends EventStreamListener {
    constructor() {
        super();
        this.pixelBytes = 0;
        this.pixelEncapsulated = null;
        this.uiValues = [];
        this._inPixelData = false;
    }
    _baseStartElement(tag) {
        this._inPixelData = tag === "7FE00010";
    }
    _baseStartBinary(info = {}) {
        if (this._inPixelData) {
            this.pixelEncapsulated = !!info.encapsulated;
        }
    }
    _baseBinaryFragment(buf) {
        if (this._inPixelData) {
            this.pixelBytes += buf.byteLength ?? buf.length ?? 0;
        }
    }
    _baseValue(value) {
        if (typeof value === "string" && /^[0-9.]+$/.test(value)) {
            this.uiValues.push(value);
        }
    }
}

describe("dicomdir — long media round trip at video scale", () => {
    let mediaRoot;

    beforeAll(() => {
        if (!LONG) {
            return;
        }
        mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dcmjs-media-"));
        fs.mkdirSync(path.join(mediaRoot, "VIDEO"));
    });

    afterAll(() => {
        if (mediaRoot) {
            fs.rmSync(mediaRoot, { recursive: true, force: true });
        }
    });

    longTest(
        "indexes a multi-GiB video file and reads the media back streaming",
        async () => {
            // --- Burn the media: huge video file + the DICOMDIR indexing it.
            const videoPath = path.join(mediaRoot, "VIDEO", "MOV00001");
            const videoSize = await writeVideoFile(videoPath);
            expect(videoSize).toBeGreaterThan(FRAGMENT_COUNT * FRAGMENT_SIZE);

            const dicomdirBytes = writeDicomDir(
                [
                    {
                        referencedFileID: ["VIDEO", "MOV00001"],
                        sopClassUid: VIDEO_PHOTOGRAPHIC_SOP_CLASS,
                        sopInstanceUid: SOP_INSTANCE_UID,
                        transferSyntaxUid: MPEG4_TS,
                        patient: {
                            PatientID: "998877",
                            PatientName: "DOE^JANE"
                        },
                        study: { StudyInstanceUID: "1.2.3.4" },
                        series: {
                            SeriesInstanceUID: "1.2.3.4.5",
                            Modality: "XC"
                        },
                        instance: { InstanceNumber: 1 }
                    }
                ],
                { fileSetID: "VIDEO_CD" }
            );
            fs.writeFileSync(
                path.join(mediaRoot, "DICOMDIR"),
                new Uint8Array(dicomdirBytes)
            );

            // The DICOMDIR indexes the file; it does not contain it. Its size
            // must be unrelated to the gigabytes it references.
            expect(dicomdirBytes.byteLength).toBeLessThan(4096);

            // --- Read the media back: DICOMDIR first, like a workstation.
            const dirListener = new NaturalizedListener();
            const dirBuffer = fs.readFileSync(path.join(mediaRoot, "DICOMDIR"));
            await fromPart10(
                dirBuffer.buffer.slice(
                    dirBuffer.byteOffset,
                    dirBuffer.byteOffset + dirBuffer.byteLength
                ),
                dirListener
            );
            const records = dirListener.result.DirectoryRecordSequence;
            const image = records.find(r => r.DirectoryRecordType === "IMAGE");
            expect(image.ReferencedFileID).toEqual(["VIDEO", "MOV00001"]);
            expect(image.ReferencedSOPInstanceUIDInFile).toBe(SOP_INSTANCE_UID);
            expect(image.ReferencedTransferSyntaxUIDInFile).toBe(MPEG4_TS);

            // --- Resolve the record to the file on disk and stream-parse it.
            const resolved = path.join(mediaRoot, ...image.ReferencedFileID);
            expect(fs.statSync(resolved).size).toBe(videoSize);

            const counter = new CountingListener();
            await fromPart10Stream(fs.createReadStream(resolved), counter);

            expect(counter.pixelEncapsulated).toBe(true);
            expect(counter.pixelBytes).toBe(FRAGMENT_COUNT * FRAGMENT_SIZE);
            expect(counter.uiValues).toContain(SOP_INSTANCE_UID);
        },
        20 * 60 * 1000
    );
});
