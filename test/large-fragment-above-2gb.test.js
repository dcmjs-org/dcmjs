/**
 * test/large-fragment-above-2gb.test.js
 *
 * A single pixel-data fragment, or a single defined-length element, may
 * declare up to 0xFFFFFFFE bytes — PS3.5 §7.1.2 gives the length field 32
 * unsigned bits. Any declared length above 2^31 (2147483648) is therefore
 * legal DICOM, and it is also the point where a signed 32-bit read silently
 * produces a negative number. A negative length does not throw: the streaming
 * reader would compute `fragEnd < fragStart`, satisfy its own bounds check,
 * and emit a short or empty fragment as if the parse had succeeded. That
 * silent corruption is what these tests guard.
 *
 * SCOPE — what these tests do NOT do: the default run never allocates a
 * fragment above 2 GB. Every file here declares a huge length and then stops,
 * so the suite stays at kilobytes and runs in the normal CI job. (One test is
 * the exception and is skipped unless DCMJS_TEST_HUGE_FRAGMENT=1 — see the
 * comment on it.) The assertions pin the arithmetic and the error text of the
 * 32-bit length path, in both directions:
 *
 *   - write: WriteBufferStream.writeUint32 — the encoder that
 *     StreamingPart10Writer calls for every fragment item header;
 *   - read: fromPart10Stream (chunked) and fromPart10 (whole-file).
 *
 * The complementary test — actually round-tripping a >2 GB fragment through
 * the disk — needs several GB of RAM and of disk, so it belongs in the
 * large-files harness, not here.
 */

import dcmjs from "../src/index.js";
import { fromPart10Stream } from "../src/eventStream/fromPart10Stream.js";
import { fromPart10 } from "../src/eventStream/fromPart10.js";
import { CollectorListener } from "../src/eventStream/CollectorListener.js";
import { StreamingPart10Writer } from "../src/eventStream/StreamingPart10Writer.js";
import { normalizeFragmentBytes } from "../src/encapsulated/encapsulatedVideo.js";
import { WriteBufferStream } from "../src/BufferStream.js";

const { DicomMessage } = dcmjs.data;

/** 3 GB: above 2^31, even, and below the 0xFFFFFFFE ceiling. */
const HUGE_LENGTH = 3000000000;
/** The largest even 32-bit length a fragment item can declare. */
const MAX_EVEN_LENGTH = 0xfffffffe; // 4294967294
/** What a signed 32-bit read of HUGE_LENGTH would produce instead. */
const HUGE_LENGTH_IF_SIGNED = HUGE_LENGTH - 4294967296; // -1294967296

const JPEG_BASELINE = "1.2.840.10008.1.2.4.50\0\0"; // even length
const EXPLICIT_LE = "1.2.840.10008.1.2.1\0"; // even length

// ---------------------------------------------------------------------------
// File builders. The lengths go on the wire through WriteBufferStream — the
// same encoder the production writer uses — so the write half of the 32-bit
// path is exercised by construction, not simulated with a local DataView.
// ---------------------------------------------------------------------------

/** Explicit-LE file meta group for `transferSyntax`, group length included. */
function writeFileMeta(stream, transferSyntax) {
    const fmi = new WriteBufferStream(256, true);
    // (0002,0001) OB FileMetaInformationVersion
    fmi.writeUint16(0x0002);
    fmi.writeUint16(0x0001);
    fmi.writeAsciiString("OB");
    fmi.writeUint16(0);
    fmi.writeUint32(2);
    fmi.writeUint8(0);
    fmi.writeUint8(1);
    // (0002,0010) UI TransferSyntaxUID
    fmi.writeUint16(0x0002);
    fmi.writeUint16(0x0010);
    fmi.writeAsciiString("UI");
    fmi.writeUint16(transferSyntax.length);
    fmi.writeAsciiString(transferSyntax);
    const fmiBytes = new Uint8Array(fmi.getBuffer(0, fmi.size));

    stream.writeUint8Repeat(0, 128); // preamble
    stream.writeAsciiString("DICM");
    // (0002,0000) UL FileMetaInformationGroupLength
    stream.writeUint16(0x0002);
    stream.writeUint16(0x0000);
    stream.writeAsciiString("UL");
    stream.writeUint16(4);
    stream.writeUint32(fmiBytes.length);
    stream.writeRawBytes(fmiBytes);
}

/**
 * An encapsulated Part 10 file with one pixel-data fragment that DECLARES
 * `declaredLength` bytes and then supplies only `suppliedBytes` of them.
 *
 * @returns {{ bytes: Uint8Array, lengthFieldOffset: number }} the file, and
 *   the offset of the fragment item's 4-byte length field.
 */
function buildEncapsulatedFile(declaredLength, suppliedBytes) {
    const s = new WriteBufferStream(4096, true);
    writeFileMeta(s, JPEG_BASELINE);
    // (7FE0,0010) OB, undefined length
    s.writeUint16(0x7fe0);
    s.writeUint16(0x0010);
    s.writeAsciiString("OB");
    s.writeUint16(0);
    s.writeUint32(0xffffffff);
    // Empty Basic Offset Table item
    s.writeUint16(0xfffe);
    s.writeUint16(0xe000);
    s.writeUint32(0);
    // The fragment item itself
    s.writeUint16(0xfffe);
    s.writeUint16(0xe000);
    const lengthFieldOffset = s.offset;
    s.writeUint32(declaredLength);
    s.writeUint8Repeat(0xab, suppliedBytes);
    if (suppliedBytes >= declaredLength) {
        // Complete fragment — close the pixel data properly.
        s.writeUint16(0xfffe);
        s.writeUint16(0xe0dd);
        s.writeUint32(0);
    }
    return { bytes: new Uint8Array(s.getBuffer(0, s.size)), lengthFieldOffset };
}

/**
 * A native (non-encapsulated) Part 10 file whose (7FE0,0010) OB element
 * DECLARES `declaredLength` bytes and supplies only `suppliedBytes`.
 */
function buildNativeFile(declaredLength, suppliedBytes) {
    const s = new WriteBufferStream(4096, true);
    writeFileMeta(s, EXPLICIT_LE);
    s.writeUint16(0x7fe0);
    s.writeUint16(0x0010);
    s.writeAsciiString("OB");
    s.writeUint16(0);
    const lengthFieldOffset = s.offset;
    s.writeUint32(declaredLength);
    s.writeUint8Repeat(0xcd, suppliedBytes);
    return { bytes: new Uint8Array(s.getBuffer(0, s.size)), lengthFieldOffset };
}

/** Feed `bytes` to the streaming reader in small chunks. */
async function* chunked(bytes, chunkSize = 64) {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        yield bytes.subarray(
            offset,
            Math.min(offset + chunkSize, bytes.length)
        );
    }
}

/** Read a 4-byte little-endian unsigned length out of a built file. */
function readLengthField(bytes, offset) {
    return new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength
    ).getUint32(offset, true);
}

/** Parse and return the thrown value, or null when the parse succeeds. */
async function parseError(promise) {
    try {
        await promise;
        return null;
    } catch (error) {
        return error;
    }
}

/** dicomParser throws a plain object with `exception`, not an Error. */
function errorText(error) {
    return String(error?.message ?? error?.exception ?? error);
}

// ---------------------------------------------------------------------------
// Write: the 32-bit length encoder
// ---------------------------------------------------------------------------

describe("writing a fragment length above 2 GB", () => {
    test("WriteBufferStream.writeUint32 encodes lengths above 2^31 unsigned", () => {
        const stream = new WriteBufferStream(8, true);
        stream.writeUint32(HUGE_LENGTH);
        stream.writeUint32(MAX_EVEN_LENGTH);
        const bytes = new Uint8Array(stream.getBuffer(0, stream.size));

        expect(readLengthField(bytes, 0)).toBe(HUGE_LENGTH);
        expect(readLengthField(bytes, 4)).toBe(MAX_EVEN_LENGTH);
    });

    test("the fragment item header carries the declared length verbatim", () => {
        // StreamingPart10Writer derives every fragment item length from
        // `bytes.byteLength + pad` and writes it with writeUint32 (the call
        // asserted above). This pins the header shape with a small fragment;
        // the >2 GB value itself is covered by the encoder test.
        const writer = new StreamingPart10Writer();
        writer.startDataSet();
        writer.startFileMetaInformation();
        writer.startElement("00020010", { vr: "UI" });
        writer.value("1.2.840.10008.1.2.4.50");
        writer.endElement();
        writer.endFileMetaInformation();
        writer.startElement("7FE00010", { vr: "OB", length: 0xffffffff });
        writer.startBinary({ encapsulated: true });
        writer.binaryFragment(new Uint8Array(1024).buffer);
        writer.endBinary();
        writer.endElement();
        writer.endDataSet();

        // The fragment header is the chunk written immediately before the
        // 1024-byte fragment: tag (4 bytes) + 32-bit length.
        const header = writer.chunks.find(
            chunk =>
                chunk.byteLength === 8 &&
                readLengthField(chunk, 0) === 0xe000fffe
        );
        expect(header).toBeDefined();
        expect(readLengthField(header, 4)).toBe(1024);
    });

    test("normalizeFragmentBytes accepts a fragment size above 2 GB", () => {
        // The encapsulation API does not stop a caller from asking for a
        // fragment larger than 2 GB; only the 32-bit ceiling is enforced.
        expect(normalizeFragmentBytes(HUGE_LENGTH)).toBe(HUGE_LENGTH);
        expect(normalizeFragmentBytes(MAX_EVEN_LENGTH - 2)).toBe(
            MAX_EVEN_LENGTH - 2
        );
    });
});

// ---------------------------------------------------------------------------
// Read: fromPart10Stream (chunked)
// ---------------------------------------------------------------------------

describe("fromPart10Stream reads a fragment length above 2 GB", () => {
    test("control: a small fragment built the same way parses correctly", async () => {
        const { bytes } = buildEncapsulatedFile(64, 64);
        const listener = new CollectorListener();
        await fromPart10Stream(chunked(bytes), listener);

        const pixelData = listener.result.dict["7FE00010"];
        expect(pixelData.Value).toHaveLength(1);
        expect(pixelData.Value[0].byteLength).toBe(64);
    });

    test("a declared 3 GB fragment is read as unsigned, not as a negative length", async () => {
        const { bytes, lengthFieldOffset } = buildEncapsulatedFile(
            HUGE_LENGTH,
            16
        );
        expect(readLengthField(bytes, lengthFieldOffset)).toBe(HUGE_LENGTH);

        const listener = new CollectorListener();
        const error = await parseError(
            fromPart10Stream(chunked(bytes), listener)
        );

        // A signed read would make fragEnd < fragStart, pass the bounds
        // check, and emit a bogus fragment instead of failing.
        expect(error).not.toBeNull();
        expect(errorText(error)).toContain(String(HUGE_LENGTH));
        expect(errorText(error)).not.toContain(String(HUGE_LENGTH_IF_SIGNED));
        expect(errorText(error)).toMatch(/truncated: pixel-data fragment/);
        expect(listener.result.dict["7FE00010"]?.Value ?? []).toHaveLength(0);
    });

    test("the maximum even 32-bit fragment length is read as unsigned", async () => {
        const { bytes, lengthFieldOffset } = buildEncapsulatedFile(
            MAX_EVEN_LENGTH,
            16
        );
        expect(readLengthField(bytes, lengthFieldOffset)).toBe(MAX_EVEN_LENGTH);

        const error = await parseError(
            fromPart10Stream(chunked(bytes), new CollectorListener())
        );

        expect(error).not.toBeNull();
        expect(errorText(error)).toContain(String(MAX_EVEN_LENGTH));
    });

    test("a native element declaring 3 GB is read as unsigned", async () => {
        const { bytes, lengthFieldOffset } = buildNativeFile(HUGE_LENGTH, 16);
        expect(readLengthField(bytes, lengthFieldOffset)).toBe(HUGE_LENGTH);

        const listener = new CollectorListener();
        const error = await parseError(
            fromPart10Stream(chunked(bytes), listener)
        );

        expect(error).not.toBeNull();
        expect(errorText(error)).toContain(String(HUGE_LENGTH));
        expect(errorText(error)).not.toContain(String(HUGE_LENGTH_IF_SIGNED));
        expect(listener.result.dict["7FE00010"]?.Value ?? []).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Read: fromPart10 (whole-file)
// ---------------------------------------------------------------------------

describe("fromPart10 reads a fragment length above 2 GB", () => {
    test("control: a small fragment built the same way parses correctly", async () => {
        const { bytes } = buildEncapsulatedFile(64, 64);
        const listener = new CollectorListener();
        await fromPart10(toArrayBuffer(bytes), listener);

        const pixelData = listener.result.dict["7FE00010"];
        expect(pixelData.Value).toHaveLength(1);
        expect(pixelData.Value[0].byteLength).toBe(64);
    });

    test("a declared 3 GB fragment fails the parse instead of emitting a short fragment", async () => {
        const { bytes } = buildEncapsulatedFile(HUGE_LENGTH, 16);
        const listener = new CollectorListener();
        const error = await parseError(
            fromPart10(toArrayBuffer(bytes), listener)
        );

        // The whole-file reader cannot satisfy the declared length, so it
        // must refuse. The thrown value comes from dicomParser and is a
        // plain object carrying `exception`, not an Error.
        expect(error).not.toBeNull();
        expect(errorText(error)).toMatch(/buffer overrun/);
        expect(listener.result.dict["7FE00010"]?.Value ?? []).toHaveLength(0);
    });

    // NOT cheap: DicomMessage.readFile materializes the declared length, so
    // this one really does allocate a 3 GB ArrayBuffer. It stays out of the
    // default run; enable it with DCMJS_TEST_HUGE_FRAGMENT=1.
    const runsHugeAllocation = process.env.DCMJS_TEST_HUGE_FRAGMENT === "1";
    (runsHugeAllocation ? test : test.skip)(
        "DicomMessage.readFile carries a 3 GB fragment length through unsigned",
        () => {
            const { bytes } = buildEncapsulatedFile(HUGE_LENGTH, 16);
            const dataset = DicomMessage.readFile(toArrayBuffer(bytes));
            const pixelData = dataset.dict["7FE00010"];

            // The length arithmetic is correct: 3000000000, not a negative
            // number and not clamped to 2^31-1.
            expect(pixelData.Value).toHaveLength(1);
            expect(pixelData.Value[0].byteLength).toBe(HUGE_LENGTH);

            // Separate, known gap this test does NOT endorse: the file
            // supplied only 16 of those bytes, and this reader pads the rest
            // with zeros instead of reporting the truncation. fromPart10 and
            // fromPart10Stream both refuse the same file (tests above).
        }
    );
});

function toArrayBuffer(bytes) {
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
    );
}
