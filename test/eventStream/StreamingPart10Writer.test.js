import fs from "fs";
import path from "path";
import dcmjs from "../../src/index.js";
import { StreamingPart10Writer } from "../../src/eventStream/StreamingPart10Writer";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { fromPart10 } from "../../src/eventStream/fromPart10";

const { DicomMessage } = dcmjs.data;

const TEST_DIR = path.join(__dirname, "..");
const readFixture = name =>
    fs.readFileSync(path.join(TEST_DIR, name)).buffer.slice(0);

/** Streams `bytes` through a StreamingPart10Writer and re-parses the output. */
async function roundTrip(bytes) {
    const writer = new StreamingPart10Writer();
    await fromPart10(bytes, writer);
    return {
        writer,
        back: DicomMessage.readFile(writer.toArrayBuffer())
    };
}

describe("StreamingPart10Writer — events to incremental Part 10 bytes", () => {
    test("round-trips a synthesized dataset (same corpus as Part10Writer)", async () => {
        const dataset = {
            meta: {
                "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] },
                "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
                "00020003": { vr: "UI", Value: ["1.2.3.4.5"] }
            },
            dict: {
                "00100010": { vr: "PN", Value: [{ Alphabetic: "Doe^Jane" }] },
                "00100020": { vr: "LO", Value: ["12345"] },
                "00080008": { vr: "CS", Value: ["ORIGINAL", "PRIMARY"] },
                "00081110": {
                    vr: "SQ",
                    Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
                }
            }
        };

        const writer = new StreamingPart10Writer();
        await fromDataSet(dataset, writer);
        const back = DicomMessage.readFile(writer.toArrayBuffer());

        expect(back.dict["00100020"].Value).toEqual(["12345"]);
        expect(back.dict["00080008"].Value).toEqual(["ORIGINAL", "PRIMARY"]);
        expect(back.dict["00100010"].Value[0].Alphabetic).toBe("Doe^Jane");
        expect(back.dict["00081110"].Value[0]["00081150"].Value).toEqual([
            "1.2.3"
        ]);
        expect(back.meta["00020010"].Value).toEqual(["1.2.840.10008.1.2.1"]);
    });

    test("round-trips an MR instance and matches the collector writer's output", async () => {
        const bytes = readFixture("sample-dicom.dcm");
        const { back } = await roundTrip(bytes);
        const original = DicomMessage.readFile(bytes.slice(0));

        for (const tag of ["00080016", "00080018", "00080060", "00280010"]) {
            expect(back.dict[tag]?.Value).toEqual(original.dict[tag]?.Value);
        }
        expect(Object.keys(back.dict).sort()).toEqual(
            Object.keys(original.dict).sort()
        );
    });

    test("round-trips a sequence-heavy SR", async () => {
        const bytes = readFixture("sample-sr.dcm");
        const { back } = await roundTrip(bytes);
        const original = DicomMessage.readFile(bytes.slice(0));

        expect(Object.keys(back.dict).sort()).toEqual(
            Object.keys(original.dict).sort()
        );
        // Content sequence survives with nesting intact
        const contentSq = "0040A730";
        expect(back.dict[contentSq].Value.length).toBe(
            original.dict[contentSq].Value.length
        );
    });

    test("round-trips encapsulated pixel data fragment-for-fragment", async () => {
        const bytes = readFixture("cine-test.dcm");
        const original = DicomMessage.readFile(bytes.slice(0));
        const { back } = await roundTrip(bytes);

        const toU8 = v =>
            v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v);
        const origFrags = original.dict["7FE00010"].Value.map(toU8);
        const backFrags = back.dict["7FE00010"].Value.map(toU8);

        expect(backFrags.length).toBe(origFrags.length);
        origFrags.forEach((frag, i) => {
            expect(backFrags[i].byteLength).toBe(frag.byteLength);
        });
        const total = arr => arr.reduce((n, f) => n + f.byteLength, 0);
        expect(total(backFrags)).toBe(total(origFrags));
    });

    test("actually streams: fragments pass through one at a time, never accumulated", () => {
        // Synthetic multi-fragment instance: what matters is the writer's own
        // behavior — each fragment must be emitted as it arrives, so the
        // largest chunk is one fragment, not the sum of them. (Real fixtures
        // in test/ are single-fragment, so this must be synthesized; the
        // 21-fragment / 21 GB case runs in the large-files harness.)
        const FRAGMENTS = 50;
        const FRAGMENT_SIZE = 64 * 1024;
        const chunkSizes = [];
        const collected = [];
        const writer = new StreamingPart10Writer({
            onChunk: chunk => {
                chunkSizes.push(chunk.byteLength);
                collected.push(chunk);
            }
        });

        writer.startDataSet();
        writer.startFileMetaInformation();
        writer.startElement("00020010", { vr: "UI" });
        writer.value("1.2.840.10008.1.2.4.104.1");
        writer.endElement();
        writer.endFileMetaInformation();
        writer.startElement("7FE00010", { vr: "OB", length: 0xffffffff });
        writer.startBinary({ encapsulated: true });
        for (let i = 0; i < FRAGMENTS; i++) {
            writer.binaryFragment(new Uint8Array(FRAGMENT_SIZE).buffer);
        }
        writer.endBinary();
        writer.endElement();
        writer.endDataSet();

        expect(Math.max(...chunkSizes)).toBe(FRAGMENT_SIZE);
        expect(
            chunkSizes.filter(s => s === FRAGMENT_SIZE).length
        ).toBe(FRAGMENTS);
        expect(writer.bytesWritten).toBe(
            chunkSizes.reduce((a, b) => a + b, 0)
        );
        expect(writer.bytesWritten).toBeGreaterThan(FRAGMENTS * FRAGMENT_SIZE);
        expect(writer.done).toBe(true);

        // And the synthetic output is valid Part 10 end to end.
        const total = new Uint8Array(writer.bytesWritten);
        let offset = 0;
        for (const chunk of collected) {
            total.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const back = DicomMessage.readFile(total.buffer, {
            ignoreErrors: true
        });
        expect(back.dict["7FE00010"].Value.length).toBe(FRAGMENTS);
    });

    test("pads odd-length encapsulated fragments", async () => {
        const writer = new StreamingPart10Writer();
        writer.startDataSet();
        writer.startFileMetaInformation();
        writer.startElement("00020010", { vr: "UI" });
        writer.value("1.2.840.10008.1.2.4.104.1");
        writer.endElement();
        writer.endFileMetaInformation();
        writer.startElement("7FE00010", { vr: "OB", length: 0xffffffff });
        writer.startBinary({ encapsulated: true });
        writer.binaryFragment(new Uint8Array([1, 2, 3]).buffer); // odd
        writer.endBinary();
        writer.endElement();
        writer.endDataSet();

        const back = DicomMessage.readFile(writer.toArrayBuffer(), {
            ignoreErrors: true
        });
        const frag = new Uint8Array(back.dict["7FE00010"].Value[0]);
        expect(frag.byteLength).toBe(4); // padded to even
        expect([...frag.subarray(0, 3)]).toEqual([1, 2, 3]);
        expect(frag[3]).toBe(0);
    });

    test("rejects the deflated transfer syntax", () => {
        const writer = new StreamingPart10Writer();
        writer.startFileMetaInformation();
        writer.startElement("00020010", { vr: "UI" });
        writer.value("1.2.840.10008.1.2.1.99");
        writer.endElement();
        expect(() => writer.endFileMetaInformation()).toThrow(/deflated/);
    });

    test("rejects bulkDataReference events", () => {
        const writer = new StreamingPart10Writer();
        writer.startFileMetaInformation();
        writer.endFileMetaInformation();
        writer.startElement("7FE00010", { vr: "OB" });
        expect(() =>
            writer.bulkDataReference({ uri: "http://example.com/bulk/1" })
        ).toThrow(/bulkDataReference/);
    });
});
