import { ReadBufferStream } from "../src/BufferStream.js";
import dcmjs from "../src/index.js";
import {
    EXPLICIT_BIG_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN
} from "../src/constants/dicom.js";
import { stripUntilDataset } from "./helper/sampleDicomPart10.js";
import {
    buildUnSequenceValueBytes,
    createPs352UnSequencePart10Buffer,
    PS352_UN_SEQUENCE_UDI
} from "./helper/ps352UnSequenceFixture.js";

const { DicomDict, DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;
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

describe("sync and async parser equivalency tests", () => {
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
            const sqKey = Object.keys(dict).find(k => k.toUpperCase() === tag);
            expect(sqKey).toBeTruthy();
            expect(dict[sqKey].vr).toBe("SQ");
            expect(dict[sqKey].Value.length).toBe(1);
            const [item] = dict[sqKey].Value;
            const udiKey = Object.keys(item).find(
                k => k.toUpperCase() === "00181009"
            );
            expect(udiKey).toBeTruthy();
            expect(item[udiKey].Value[0].trimEnd()).toBe(PS352_UN_SEQUENCE_UDI);
        }

        test("sync parser reads PS3.5 UN sequence via DicomMessage.read on dataset", () => {
            const part10 = createPs352UnSequencePart10Buffer();
            const datasetBytes = stripUntilDataset(part10);
            const stream = new ReadBufferStream(datasetBytes, true);
            const dict = DicomMessage.read(
                stream,
                EXPLICIT_LITTLE_ENDIAN,
                false
            );
            expectPs352SequenceDict(dict);

            // Write round trip: the sequence keeps one item and a small length.
            const written = DicomMessage.readFile(part10).write();
            expect(written.byteLength).toBeLessThan(1024);
            expect(elementHeaderHex(written, "18000a10")).toBe(
                "18000a1053510000ffffffff"
            );
            expectPs352SequenceDict(DicomMessage.readFile(written).dict);
        });

        // Header bytes (tag, VR, length) of the first dataset element with this LE tag.
        function elementHeaderHex(part10, tagHexLE) {
            const hex = Buffer.from(part10).toString("hex");
            const at = hex.indexOf(tagHexLE, 132 * 2);
            return hex.slice(at, at + 24);
        }

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

        test("async parser reads PS3.5 UN sequence via readFile on Part 10", async () => {
            const part10 = createPs352UnSequencePart10Buffer();
            const reader = new AsyncDicomReader();

            reader.stream.addBuffer(new Uint8Array(part10));
            reader.stream.setComplete();

            const { dict } = await reader.readFile();
            expectPs352SequenceDict(dict);
        });

        async function readSyncAndAsync(dict, syntax) {
            const part10 = createPs352UnSequencePart10Buffer(dict, syntax);
            const reader = new AsyncDicomReader();
            reader.stream.addBuffer(new Uint8Array(part10));
            reader.stream.setComplete();
            return [
                DicomMessage.readFile(part10).dict,
                (await reader.readFile()).dict
            ];
        }

        test("a private UN tag that holds a sequence is read as SQ", async () => {
            const dicts = await readSyncAndAsync({
                "00090010": { vr: "LO", Value: ["X"] },
                "00091010": { vr: "UN", Value: [buildUnSequenceValueBytes()] }
            });
            dicts.forEach(dict => expectPs352SequenceDict(dict, "00091010"));
        });

        test("a private UN value that starts with FE FF but not the item tag stays UN", async () => {
            const bytes = [0xfe, 0xff, 1, 2, 3, 4, 5, 6];
            const dicts = await readSyncAndAsync({
                "00090010": { vr: "LO", Value: ["X"] },
                "00091010": { vr: "UN", Value: [new Uint8Array(bytes).buffer] }
            });
            for (const dict of dicts) {
                expect(dict["00091010"].vr).toBe("UN");
                expect([...new Uint8Array(dict["00091010"].Value[0])]).toEqual(
                    bytes
                );
            }
        });

        test("Explicit VR Big Endian: a private UN sequence keeps its item", async () => {
            const dicts = await readSyncAndAsync(
                {
                    "00090010": { vr: "LO", Value: ["X"] },
                    "00091010": {
                        vr: "UN",
                        Value: [buildUnSequenceValueBytes()]
                    },
                    "00091011": { vr: "LO", Value: ["AFTER"] }
                },
                EXPLICIT_BIG_ENDIAN
            );
            for (const dict of dicts) {
                expectPs352SequenceDict(dict, "00091010");
                expect(dict["00091011"].Value[0].trim()).toBe("AFTER");
            }
        });

        test.each([
            [
                "a private UN with the item tag and a bad item length",
                "00091010",
                [0xfe, 0xff, 0x00, 0xe0, 0, 0, 1, 0, 1, 2, 3, 4, 5, 6, 7, 8]
            ],
            [
                "a standard OB tag sent as UN that starts with the item tag",
                "00420011",
                [0xfe, 0xff, 0x00, 0xe0, 4, 0, 0, 0, 9, 9, 9, 9]
            ]
        ])("%s keeps its bytes", async (_name, tag, bytes) => {
            const dicts = await readSyncAndAsync({
                "00090010": { vr: "LO", Value: ["X"] },
                [tag]: { vr: "UN", Value: [new Uint8Array(bytes).buffer] }
            });
            for (const dict of dicts) {
                expect(dict[tag].vr).not.toBe("SQ");
                expect([...new Uint8Array(dict[tag].Value[0])]).toEqual(bytes);
            }
        });

        // The 0.x UN writer has no InlineBinary support, so the write throws, as before #496.
        test("a UN with an InlineBinary reference is not written as SQ", () => {
            const dicomDict = new DicomDict({
                "00020010": { vr: "UI", Value: [EXPLICIT_LITTLE_ENDIAN] }
            });
            dicomDict.dict = {
                "00090010": { vr: "LO", Value: ["X"] },
                "00091010": { vr: "UN", Value: [{ InlineBinary: "AAECAw==" }] }
            };
            expect(() => dicomDict.write()).toThrow(TypeError);
        });
    });
});
