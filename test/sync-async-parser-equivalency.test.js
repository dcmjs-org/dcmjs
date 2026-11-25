import dcmjs from "../src/index.js";
import { WriteBufferStream } from "../src/BufferStream";
import { fromPart10 } from "../src/eventStream/fromPart10.js";
import { fromPart10Stream } from "../src/eventStream/fromPart10Stream.js";
import { CollectorListener } from "../src/eventStream/CollectorListener.js";
import { LENGTH_CASES, writeSequenceItems } from "./helper/sequenceItems";

const { DicomDict, DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;

const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";
const IMPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2";
const TEST_SQ_TAG = "00081115";
const TEST_UV_TAG = "00111011";
const TEST_UV_VALUES = [BigInt("9007199254741992"), BigInt("9007199254741993")];

DicomDict.setDicomMessageClass(DicomMessage);

function toArrayBuffer(bufferLike) {
    if (bufferLike instanceof ArrayBuffer) {
        const copy = new ArrayBuffer(bufferLike.byteLength);
        new Uint8Array(copy).set(new Uint8Array(bufferLike));
        return copy;
    }

    const u8 = new Uint8Array(
        bufferLike.buffer,
        bufferLike.byteOffset,
        bufferLike.byteLength
    );
    const copy = new ArrayBuffer(u8.length);
    new Uint8Array(copy).set(u8);
    return copy;
}

function createPart10WithUV() {
    const dicomDict = new DicomDict({
        "00020010": {
            vr: "UI",
            Value: [EXPLICIT_LITTLE_ENDIAN]
        }
    });

    dicomDict.dict = {
        [TEST_UV_TAG]: {
            vr: "UV",
            Value: TEST_UV_VALUES
        }
    };

    return toArrayBuffer(dicomDict.write());
}

/**
 * Part 10 with one sequence of the items [{}, item, {}]. The sequence bytes
 * are written by hand, so that each length form is used on the wire.
 */
function createPart10WithEmptyItems(syntax, undefinedSequence, undefinedItems) {
    const head = new DicomDict({ "00020010": { vr: "UI", Value: [syntax] } });
    const { stream: items, sqLength } = writeSequenceItems(
        [{}, { "00280010": { vr: "US", Value: [4] } }, {}],
        syntax,
        undefinedSequence,
        undefinedItems
    );
    const sq = new WriteBufferStream({ defaultSize: 256 });
    sq.writeUint16(0x0008);
    sq.writeUint16(0x1115);
    if (syntax === EXPLICIT_LITTLE_ENDIAN) {
        sq.writeAsciiString("SQ");
        sq.writeUint16(0);
    }
    sq.writeUint32(sqLength);
    sq.concat(items);

    const headBytes = new Uint8Array(head.write());
    const out = new Uint8Array(headBytes.length + sq.size);
    out.set(headBytes);
    out.set(new Uint8Array(sq.getBuffer()), headBytes.length);
    return out.buffer;
}

const readers = {
    sync: async part10 => DicomMessage.readFile(part10).dict,
    async: async part10 => {
        const reader = new AsyncDicomReader();
        reader.stream.addBuffer(part10);
        reader.stream.setComplete();
        return (await reader.readFile()).dict;
    },
    fromPart10: async part10 => {
        const listener = new CollectorListener();
        await fromPart10(part10, listener);
        return listener.result.dict;
    },
    fromPart10Stream: async part10 => {
        const listener = new CollectorListener();
        await fromPart10Stream(part10, listener);
        return listener.result.dict;
    }
};

describe("sync and async parser equivalency tests", () => {
    // dcmjs #606: an empty item must stay in its position in the sequence.
    describe.each(Object.keys(readers))("%s reader", name => {
        describe.each([EXPLICIT_LITTLE_ENDIAN, IMPLICIT_LITTLE_ENDIAN])(
            "syntax %s",
            syntax => {
                test.each(LENGTH_CASES)(
                    "keeps empty items (undefined sequence: %s, undefined items: %s)",
                    async (undefinedSequence, undefinedItems) => {
                        const part10 = createPart10WithEmptyItems(
                            syntax,
                            undefinedSequence,
                            undefinedItems
                        );
                        const dict = await readers[name](part10);
                        const items = dict[TEST_SQ_TAG].Value;

                        expect(items).toHaveLength(3);
                        expect(items[0]).toEqual({});
                        expect(items[1]["00280010"].Value).toEqual([4]);
                        expect(items[2]).toEqual({});
                    }
                );
            }
        );
    });

    describe("UV containing Part 10", () => {
        test("sync parser reads UV value into parsed object", () => {
            const part10 = createPart10WithUV();
            const parsed = DicomMessage.readFile(part10);

            expect(parsed.dict[TEST_UV_TAG]).toBeDefined();
            expect(parsed.dict[TEST_UV_TAG].vr).toBe("UV");
            expect(parsed.dict[TEST_UV_TAG].Value).toEqual(TEST_UV_VALUES);
        });

        test("async parser reads UV value into parsed object", async () => {
            const part10 = createPart10WithUV();
            const reader = new AsyncDicomReader();

            reader.stream.addBuffer(part10);
            reader.stream.setComplete();

            const parsed = await reader.readFile();

            expect(parsed.dict[TEST_UV_TAG]).toBeDefined();
            expect(parsed.dict[TEST_UV_TAG].vr).toBe("UV");
            expect(parsed.dict[TEST_UV_TAG].Value).toEqual(TEST_UV_VALUES);
        });
    });
});
