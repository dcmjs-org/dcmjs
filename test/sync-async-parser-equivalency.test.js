import dcmjs from "../src/index.js";
import { ReadBufferStream, WriteBufferStream } from "../src/BufferStream.js";
import {
    EXPLICIT_BIG_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN
} from "../src/constants/dicom.js";
import { fromPart10 } from "../src/eventStream/fromPart10.js";
import { fromPart10Stream } from "../src/eventStream/fromPart10Stream.js";
import { CollectorListener } from "../src/eventStream/CollectorListener.js";
import { stripUntilDataset } from "./helper/sampleDicomPart10.js";
import {
    buildUnSequenceValueBytes,
    createPs352UnSequenceDatasetElementBuffer,
    createPs352UnSequencePart10Buffer,
    PS352_UN_SEQUENCE_UDI
} from "./helper/ps352UnSequenceFixture.js";
import { LENGTH_CASES, writeSequenceItems } from "./helper/sequenceItems";

const { DicomDict, DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;

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

/**
 * Part 10 with a private UN element (0009,1010) of undefined length that holds
 * one item. PS3.5 6.2.2 encodes the item in Implicit VR Little Endian, also in
 * a Big Endian file. A top-level element follows the sequence.
 */
function createPart10WithUndefinedLengthUn(syntax, itemLength = 0xffffffff) {
    const le = syntax !== EXPLICIT_BIG_ENDIAN;
    const head = new DicomDict({ "00020010": { vr: "UI", Value: [syntax] } });
    const bytes = [];
    const u16 = (v, little) => [
        little ? v & 0xff : v >> 8,
        little ? v >> 8 : v & 0xff
    ];
    const u32 = (v, little) => {
        const b = [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
        return little ? b.reverse() : b;
    };
    const tag = (g, e, little) => [...u16(g, little), ...u16(e, little)];
    const ascii = text => [...text].map(c => c.charCodeAt(0));

    // (0009,0010) LO "X ", the private creator
    bytes.push(...tag(0x0009, 0x0010, le), ...ascii("LO"), ...u16(2, le));
    bytes.push(...ascii("X "));
    // (0009,1010) UN, undefined length
    bytes.push(...tag(0x0009, 0x1010, le), ...ascii("UN"), 0, 0);
    bytes.push(...u32(0xffffffff, le));
    // the item and its content are Implicit VR Little Endian
    const inner = [...tag(0x0028, 0x1201, true), ...u32(4, true), 1, 2, 3, 4];
    bytes.push(...tag(0xfffe, 0xe000, true), ...u32(itemLength, true));
    bytes.push(...inner);
    if (itemLength === 0xffffffff) {
        bytes.push(...tag(0xfffe, 0xe00d, true), ...u32(0, true));
    }
    bytes.push(...tag(0xfffe, 0xe0dd, true), ...u32(0, true));
    // (0010,0020) LO "ID1 ", after the sequence
    bytes.push(...tag(0x0010, 0x0020, le), ...ascii("LO"), ...u16(4, le));
    bytes.push(...ascii("ID1 "));

    const headBytes = new Uint8Array(head.write());
    const out = new Uint8Array(headBytes.length + bytes.length);
    out.set(headBytes);
    out.set(bytes, headBytes.length);
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

    describe("PS3.5 6.2.2 UN defined-length sequence (Implicit LE value)", () => {
        function expectPs352SequenceDict(dict, tag = "0018100A") {
            expect(dict[tag].vr).toBe("SQ");
            expect(dict[tag].Value.length).toBe(1);
            const [item] = dict[tag].Value;
            expect(item["00181009"].Value[0].trimEnd()).toBe(
                PS352_UN_SEQUENCE_UDI
            );
        }

        // Header bytes (tag, VR, length) of the first dataset element with this LE tag.
        function elementHeaderHex(part10, tagHexLE) {
            const hex = Buffer.from(part10).toString("hex");
            const at = hex.indexOf(tagHexLE, 132 * 2);
            return hex.slice(at, at + 24);
        }

        // sync, async, and the event-stream readers (buffered and streamed)
        async function readAll(part10) {
            const reader = new AsyncDicomReader();
            reader.stream.addBuffer(new Uint8Array(part10));
            reader.stream.setComplete();
            const buffered = new CollectorListener();
            await fromPart10(part10.slice(0), buffered);
            const streamed = new CollectorListener();
            await fromPart10Stream(part10.slice(0), streamed);
            return [
                DicomMessage.readFile(part10).dict,
                (await reader.readFile()).dict,
                buffered.result.dict,
                streamed.result.dict
            ];
        }

        test("DicomMessage._readTag reads a UN element that holds a sequence as SQ", () => {
            const stream = new ReadBufferStream(
                createPs352UnSequenceDatasetElementBuffer()
            );
            const result = DicomMessage._readTag(
                stream,
                EXPLICIT_LITTLE_ENDIAN
            );
            expect(result.vr.type).toBe("SQ");
            expect(result.values[0]["00181009"].Value[0].trimEnd()).toBe(
                PS352_UN_SEQUENCE_UDI
            );
        });

        test("sync parser reads the dataset, and a write round trip keeps the sequence", () => {
            const part10 = createPs352UnSequencePart10Buffer();
            const stream = new ReadBufferStream(stripUntilDataset(part10));
            expectPs352SequenceDict(
                DicomMessage.read(stream, EXPLICIT_LITTLE_ENDIAN, false)
            );

            const written = DicomMessage.readFile(part10).write();
            expect(written.byteLength).toBeLessThan(1024);
            expect(elementHeaderHex(written, "18000a10")).toBe(
                "18000a1053510000ffffffff"
            );
            expectPs352SequenceDict(DicomMessage.readFile(written).dict);
        });

        test("all readers read a standard UN tag that holds a sequence as SQ", async () => {
            const dicts = await readAll(createPs352UnSequencePart10Buffer());
            dicts.forEach(dict => expectPs352SequenceDict(dict));
        });

        test("all readers read a private UN tag that holds a sequence as SQ", async () => {
            const dicts = await readAll(
                createPs352UnSequencePart10Buffer({
                    "00090010": { vr: "LO", Value: ["X"] },
                    "00091010": {
                        vr: "UN",
                        Value: [buildUnSequenceValueBytes()]
                    }
                })
            );
            dicts.forEach(dict => expectPs352SequenceDict(dict, "00091010"));
        });

        test("all readers read a UN sequence in Explicit VR Big Endian, and the element after it", async () => {
            const dicts = await readAll(
                createPs352UnSequencePart10Buffer(
                    {
                        "00090010": { vr: "LO", Value: ["X"] },
                        "00091010": {
                            vr: "UN",
                            Value: [buildUnSequenceValueBytes()]
                        },
                        "00100020": { vr: "LO", Value: ["ID1"] }
                    },
                    EXPLICIT_BIG_ENDIAN
                )
            );
            for (const dict of dicts) {
                expectPs352SequenceDict(dict, "00091010");
                expect(dict["00100020"].Value).toEqual(["ID1"]);
            }
        });

        // Values that start with the item tag but are not a §6.2.2 sequence.
        test.each([
            [
                "a private UN with an item length larger than the value",
                "00091010",
                [0xfe, 0xff, 0, 0xe0, 0, 0, 1, 0, 1, 2, 3, 4, 5, 6, 7, 8],
                "UN"
            ],
            [
                "a standard UN tag whose dictionary VR is OB",
                "00420011",
                [0xfe, 0xff, 0, 0xe0, 4, 0, 0, 0, 9, 9, 9, 9],
                "OB"
            ]
        ])("all readers keep the bytes of %s", async (_, tag, bytes, vr) => {
            const dicts = await readAll(
                createPs352UnSequencePart10Buffer({
                    "00090010": { vr: "LO", Value: ["X"] },
                    [tag]: { vr: "UN", Value: [new Uint8Array(bytes).buffer] }
                })
            );
            for (const dict of dicts) {
                expect(dict[tag].vr).toBe(vr);
                expect([...new Uint8Array(dict[tag].Value[0])]).toEqual(bytes);
            }
        });

        // PS3.5 6.2.2 also covers a UN element of undefined length
        test.each([
            [EXPLICIT_LITTLE_ENDIAN, 0xffffffff],
            [EXPLICIT_LITTLE_ENDIAN, 12],
            [EXPLICIT_BIG_ENDIAN, 0xffffffff],
            [EXPLICIT_BIG_ENDIAN, 12]
        ])(
            "%s: all readers read a UN element of undefined length that holds a sequence (item length %i)",
            async (syntax, itemLength) => {
                const dicts = await readAll(
                    createPart10WithUndefinedLengthUn(syntax, itemLength)
                );
                for (const dict of dicts) {
                    expect(dict["00091010"].vr).toBe("SQ");
                    expect(dict["00091010"].Value.length).toBe(1);
                    expect([
                        ...new Uint8Array(
                            dict["00091010"].Value[0]["00281201"].Value[0]
                        )
                    ]).toEqual([1, 2, 3, 4]);
                    expect(dict["00100020"].Value).toEqual(["ID1"]);
                }
            }
        );

        test.each([
            [{ InlineBinary: "AAECAw==" }],
            [{ BulkDataURI: "http://example.com/bulk" }]
        ])(
            "a UN element with the binary reference %j is not written as SQ",
            ref => {
                const dicomDict = new DicomDict({
                    "00020010": { vr: "UI", Value: [EXPLICIT_LITTLE_ENDIAN] }
                });
                dicomDict.dict = {
                    "00090010": { vr: "LO", Value: ["X"] },
                    "00091010": { vr: "UN", Value: [ref] }
                };
                const written = dicomDict.write();
                expect(elementHeaderHex(written, "09001010").slice(8, 12)).toBe(
                    "554e"
                );
            }
        );

        test.each([
            [EXPLICIT_LITTLE_ENDIAN, "0900101053510000ffffffff"],
            [IMPLICIT_LITTLE_ENDIAN, "09001010fffffffffeff00e0"]
        ])(
            "%s: a UN element with item objects as Value is written as SQ with undefined length",
            (syntax, expectedHeader) => {
                const dicomDict = new DicomDict({
                    "00020010": { vr: "UI", Value: [syntax] }
                });
                dicomDict.dict = {
                    "00090010": { vr: "LO", Value: ["X"] },
                    "00091010": {
                        vr: "UN",
                        Value: [
                            {
                                "00181009": {
                                    vr: "UT",
                                    Value: [PS352_UN_SEQUENCE_UDI]
                                }
                            }
                        ]
                    }
                };
                const written = dicomDict.write();
                expect(elementHeaderHex(written, "09001010")).toBe(
                    expectedHeader
                );
                expectPs352SequenceDict(
                    DicomMessage.readFile(written).dict,
                    "00091010"
                );
            }
        );
    });
});
