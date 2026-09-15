import fs from "fs";
import path from "path";
import dcmjs from "../src/index.js";
import { WriteBufferStream } from "../src/BufferStream";
import {
    buildWriterBackpatchDict,
    writerBackpatchCases,
    makeBigText,
    EXPLICIT_LITTLE_ENDIAN
} from "./fixtures/writerBackpatchDataset";

const { DicomMessage } = dcmjs.data;

/**
 * Byte-identity regression suite for the eager writer rework (direct
 * destination-stream writes + length backpatching, docs roadmap R4 item 2).
 *
 * The expected fixtures were captured by running DicomDict.write() with the
 * PRE-rework writer (per-element temporary WriteBufferStream + concat, see
 * git history of src/Tag.js), so any byte produced differently by the
 * reworked writer fails this suite.
 */
describe("writer backpatch byte identity", () => {
    writerBackpatchCases.forEach(testCase => {
        it(`writes byte-identical output (${testCase.name})`, () => {
            const dict = buildWriterBackpatchDict(testCase.transferSyntaxUID, {
                encapsulated: !!testCase.encapsulated
            });
            const actual = Buffer.from(dict.write());
            const expected = fs.readFileSync(
                path.join(__dirname, "fixtures", testCase.fixtureName)
            );
            expect(actual.length).toBe(expected.length);
            expect(actual.equals(expected)).toBe(true);
        });
    });

    it("encodes a > 0xffff byte string VR element as Big 16 (UN + 32 bit length)", () => {
        const dict = buildWriterBackpatchDict(EXPLICIT_LITTLE_ENDIAN);
        const out = Buffer.from(dict.write());

        // (0010,4000) LT with 70001 chars (padded to 70002) must be written
        // with the UN VR substitution and a 4-byte length field.
        const bigTextLength = makeBigText().length + 1; // odd value, padded
        const header = Buffer.from([
            0x10,
            0x00,
            0x00,
            0x40, // tag (0010,4000) little endian
            0x55,
            0x4e, // "UN"
            0x00,
            0x00 // reserved
        ]);
        const headerIndex = out.indexOf(header);
        expect(headerIndex).toBeGreaterThan(0);
        expect(out.readUInt32LE(headerIndex + 8)).toBe(bigTextLength);

        // (0028,1201) US with 40000 entries (80000 bytes) takes the same
        // Big 16 encoding, with the exactly precomputed length.
        const usHeader = Buffer.from([
            0x28,
            0x00,
            0x01,
            0x12, // tag (0028,1201) little endian
            0x55,
            0x4e, // "UN"
            0x00,
            0x00 // reserved
        ]);
        const usHeaderIndex = out.indexOf(usHeader);
        expect(usHeaderIndex).toBeGreaterThan(0);
        expect(out.readUInt32LE(usHeaderIndex + 8)).toBe(80000);

        // (0042,0011) OB with 999 bytes (> 256 byte binary, odd) keeps its
        // own VR with the padded 4-byte length.
        const obHeader = Buffer.from([
            0x42,
            0x00,
            0x11,
            0x00, // tag (0042,0011) little endian
            0x4f,
            0x42, // "OB"
            0x00,
            0x00 // reserved
        ]);
        const obHeaderIndex = out.indexOf(obHeader);
        expect(obHeaderIndex).toBeGreaterThan(0);
        expect(out.readUInt32LE(obHeaderIndex + 8)).toBe(1000);
    });

    it("round trips through readFile", () => {
        const dict = buildWriterBackpatchDict(EXPLICIT_LITTLE_ENDIAN);
        const out = dict.write();
        const readBack = DicomMessage.readFile(out);

        expect(readBack.dict["00100020"].Value).toEqual(["PATIENT-1"]);
        expect(readBack.dict["00080008"].Value).toEqual([
            "ORIGINAL",
            "PRIMARY"
        ]);
        // The Big 16 elements read back through the UN + dictionary re-parse
        // path with their content intact.
        const bigText = makeBigText();
        expect(readBack.dict["00104000"].Value[0].substring(0, 100)).toBe(
            bigText.substring(0, 100)
        );
        // 00281201 is dictionary VR OW: the Big 16 UN element re-parses to
        // a single binary buffer holding all 40000 uint16 entries.
        const lut = readBack.dict["00281201"].Value[0];
        expect(lut.byteLength).toBe(80000);
        expect(new DataView(lut).getUint16(39999 * 2, true)).toBe(
            (39999 * 13) % 0x10000
        );
        // Nested sequence content survives.
        const items = readBack.dict["00081115"].Value;
        expect(items.length).toBe(2);
        expect(items[1]["00081140"].Value[0]["00081155"].Value).toEqual([
            "1.2.840.99999.1.2.3.4"
        ]);
    });
});

describe("backpatch stream helpers", () => {
    it("writeUint16At/writeUint32At patch across chunk boundaries", () => {
        // Tiny default size forces the reserved length fields to straddle
        // chunk boundaries.
        const stream = new WriteBufferStream(3, true);
        stream.writeUint8(0xaa);
        const offset16 = stream.offset;
        stream.writeUint16(0);
        const offset32 = stream.offset;
        stream.writeUint32(0);
        stream.writeUint8(0xbb);

        stream.writeUint16At(offset16, 0xc1d2);
        stream.writeUint32At(offset32, 0xdeadbeef);

        expect(stream.view.getUint8(0)).toBe(0xaa);
        expect(stream.view.getUint16(offset16, true)).toBe(0xc1d2);
        expect(stream.view.getUint32(offset32, true)).toBe(0xdeadbeef);
        expect(stream.view.getUint8(offset32 + 4)).toBe(0xbb);
        // Patching does not move the write position.
        expect(stream.offset).toBe(offset32 + 5);
        expect(stream.size).toBe(offset32 + 5);
    });
});
