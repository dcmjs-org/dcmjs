import { ReadBufferStream } from "../src/BufferStream.js";
import dcmjs from "../src/index.js";
import { EXPLICIT_LITTLE_ENDIAN } from "../src/constants/dicom.js";
import { stripUntilDataset } from "./helper/sampleDicomPart10.js";
import {
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
        function expectPs352SequenceDict(dict) {
            const sqKey = Object.keys(dict).find(
                k => k.toUpperCase() === "0018100A"
            );
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
        });

        test("async parser reads PS3.5 UN sequence via readFile on Part 10", async () => {
            const part10 = createPs352UnSequencePart10Buffer();
            const reader = new AsyncDicomReader();

            reader.stream.addBuffer(new Uint8Array(part10));
            reader.stream.setComplete();

            const { dict } = await reader.readFile();
            expectPs352SequenceDict(dict);
        });
    });
});
