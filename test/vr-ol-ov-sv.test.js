import dcmjs from "../src/index.js";
import { ValueRepresentation } from "../src/ValueRepresentation";

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;

const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";
const TEST_SV_TAG = "00111012";
const TEST_SV_VALUES = [
    BigInt("-9007199254741992"),
    BigInt("9007199254741993")
];

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

describe("OL, OV and SV value representations", () => {
    test.each(["OL", "OV", "SV"])(
        "createByTypeString(%s) returns that VR instead of UN",
        type => {
            expect(ValueRepresentation.createByTypeString(type).type).toBe(
                type
            );
        }
    );

    test.each([
        ["(0066,0040)", "LongPrimitivePointIndexList"],
        ["(0066,0041)", "LongTrianglePointIndexList"],
        ["(0066,0042)", "LongEdgePointIndexList"],
        ["(0066,0043)", "LongVertexPointIndexList"]
    ])("%s %s is OL VM 1", (tag, name) => {
        expect(DicomMetaDictionary.dictionary[tag]).toMatchObject({
            vr: "OL",
            vm: "1",
            name
        });
    });

    test("LongTrianglePointIndexList written as OL round-trips as OL", () => {
        const indices = new Uint32Array([0, 1, 2, 2, 3, 0]);
        const dicomDict = new DicomDict({
            "00020010": {
                vr: "UI",
                Value: [EXPLICIT_LITTLE_ENDIAN]
            }
        });
        dicomDict.dict["00660041"] = {
            vr: "OL",
            Value: [indices.buffer]
        };

        const parsed = DicomMessage.readFile(dicomDict.write());
        expect(parsed.dict["00660041"].vr).toBe("OL");
        expect(
            Array.from(new Uint32Array(parsed.dict["00660041"].Value[0]))
        ).toEqual(Array.from(indices));
    });

    test("OV binary payload round-trips with VR OV", () => {
        const bytes = new Uint8Array([
            0x00, 0x00, 0x30, 0xc0, 0x00, 0x00, 0x28, 0x41
        ]);
        const dicomDict = new DicomDict({
            "00020010": {
                vr: "UI",
                Value: [EXPLICIT_LITTLE_ENDIAN]
            }
        });
        // Private/unknown tag so dictionary lookup cannot rewrite UN -> OV
        dicomDict.dict["00111013"] = {
            vr: "OV",
            Value: [bytes.buffer]
        };

        const parsed = DicomMessage.readFile(dicomDict.write());
        expect(parsed.dict["00111013"].vr).toBe("OV");
        expect(new Uint8Array(parsed.dict["00111013"].Value[0])).toEqual(bytes);
    });

    describe("SV containing Part 10", () => {
        function createPart10WithSV() {
            const dicomDict = new DicomDict({
                "00020010": {
                    vr: "UI",
                    Value: [EXPLICIT_LITTLE_ENDIAN]
                }
            });

            dicomDict.dict = {
                [TEST_SV_TAG]: {
                    vr: "SV",
                    Value: TEST_SV_VALUES
                }
            };

            return toArrayBuffer(dicomDict.write());
        }

        test("sync parser reads SV value into parsed object", () => {
            const part10 = createPart10WithSV();
            const parsed = DicomMessage.readFile(part10);

            expect(parsed.dict[TEST_SV_TAG]).toBeDefined();
            expect(parsed.dict[TEST_SV_TAG].vr).toBe("SV");
            expect(parsed.dict[TEST_SV_TAG].Value).toEqual(TEST_SV_VALUES);
        });

        test("async parser reads SV value into parsed object", async () => {
            const part10 = createPart10WithSV();
            const reader = new AsyncDicomReader();

            reader.stream.addBuffer(part10);
            reader.stream.setComplete();

            const parsed = await reader.readFile();

            expect(parsed.dict[TEST_SV_TAG]).toBeDefined();
            expect(parsed.dict[TEST_SV_TAG].vr).toBe("SV");
            expect(parsed.dict[TEST_SV_TAG].Value).toEqual(TEST_SV_VALUES);
        });
    });
});
