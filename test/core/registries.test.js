import dcmjs from "../../src/index.js";
import {
    ReadBufferStream,
    WriteBufferStream,
    Vrs,
    registerVr,
    SopClasses,
    registerSopClass,
    sopClassName,
    registerCharacterSet,
    validationLog
} from "@dcmjs-org/core";

import { StreamingPart10Writer } from "../../src/eventStream/StreamingPart10Writer";
import { fromDataSet } from "../../src/eventStream/fromDataSet";

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;

const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";

/** Writes a tag-keyed dict as Part 10 and returns the bytes. */
function writePart10(dict) {
    const dicomDict = new DicomDict({
        "00020010": { vr: "UI", Value: [EXPLICIT_LITTLE_ENDIAN] }
    });
    dicomDict.dict = dict;
    return new Uint8Array(dicomDict.write());
}

function readDict(bytes) {
    return DicomMessage.readFile(bytes.buffer.slice(0)).dict;
}

function containsBytes(bytes, pattern) {
    return bytes.some((_, i) => pattern.every((b, j) => bytes[i + j] === b));
}

describe("stream constructors (REG-U-16, REG-U-17)", () => {
    it("API: the legacy 3-argument ReadBufferStream keeps start and stop", () => {
        const buffer = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7).buffer;
        const stream = new ReadBufferStream(buffer, true, {
            start: 2,
            stop: 6
        });
        expect(stream.offset).toBe(2);
        expect(stream.endOffset).toBe(6);
        expect(stream.readUint16()).toBe(0x0302);

        // an explicit undefined or 0 byte order is the 0.x form: big endian
        for (const byteOrder of [undefined, 0]) {
            expect(new ReadBufferStream(buffer, byteOrder).readUint16()).toBe(
                0x0001
            );
        }
        expect(new ReadBufferStream(buffer).readUint16()).toBe(0x0100);
    });

    it("API: legacy WriteBufferStream(n, false) is big endian; the new form defaults to little endian", () => {
        const big = new WriteBufferStream(16, false);
        big.writeUint16(0x0102);
        expect([...new Uint8Array(big.getBuffer())]).toEqual([1, 2]);

        const little = new WriteBufferStream();
        little.writeUint16(0x0102);
        expect([...new Uint8Array(little.getBuffer())]).toEqual([2, 1]);
    });
});

describe("VR registry (REG-U-2)", () => {
    it("API: registerVr makes an unknown VR decode with the registered instance", () => {
        // write (0066,0040) as OW, then change the VR bytes to OV, which has no class
        const bytes = writePart10({
            "00660040": { vr: "OW", Value: [Uint8Array.of(1, 0, 0, 0).buffer] }
        });
        const at = bytes.findIndex(
            (b, i) =>
                b === 0x66 &&
                bytes[i + 2] === 0x40 &&
                bytes[i + 4] === 0x4f &&
                bytes[i + 5] === 0x57
        );
        bytes[at + 5] = "V".charCodeAt(0);

        const otherVeryLong = new Vrs.OW.constructor();
        otherVeryLong.type = "OV";
        registerVr("OV", otherVeryLong, {
            length32: true,
            single: true,
            readSingle: true,
            byteStream: true
        });
        const warn = jest.spyOn(validationLog, "warn");

        const element = readDict(bytes)["00660040"];

        expect(Vrs.OV).toBe(otherVeryLong);
        expect(element.vr).toBe("OV");
        expect(new Uint8Array(element.Value[0])).toEqual(
            Uint8Array.of(1, 0, 0, 0)
        );
        expect(warn).not.toHaveBeenCalledWith(
            "Invalid vr type",
            "OV",
            "- using UN"
        );
        warn.mockRestore();
    });
});

describe("SOP class registry (REG-U-5 to REG-U-8)", () => {
    it("API: SopClasses, registerSopClass and the dictionary maps agree", () => {
        expect(SopClasses.CTImage).toBe("1.2.840.10008.5.1.4.1.1.2");
        expect(sopClassName("1.2.840.10008.5.1.4.1.1.2")).toBe("CTImage");

        registerSopClass("VendorImage", "1.2.3.4.5");
        expect(DicomMetaDictionary.sopClassUIDsByName.VendorImage).toBe(
            "1.2.3.4.5"
        );
        expect(DicomMetaDictionary.sopClassNamesByUID["1.2.3.4.5"]).toBe(
            "VendorImage"
        );

        // the 0.x way: edit the map of names, then rebuild
        DicomMetaDictionary.sopClassNamesByUID["1.2.3.4.6"] = "OtherImage";
        DicomMetaDictionary._generateUIDMap();
        expect(DicomMetaDictionary.sopClassUIDsByName.OtherImage).toBe(
            "1.2.3.4.6"
        );
        expect(SopClasses.OtherImage).toBe("1.2.3.4.6");
    });
});

describe("character-set write (REG-U-9 to REG-U-11)", () => {
    it("user: ISO_IR 100 writes é as 0xE9 and reads back equal", () => {
        const bytes = writePart10({
            "00080005": { vr: "CS", Value: ["ISO_IR 100"] },
            "00100020": { vr: "LO", Value: [12345] },
            "00104000": { vr: "LT", Value: ["Zoë é"] }
        });
        expect(containsBytes(bytes, [0x5a, 0x6f, 0xeb, 0x20, 0xe9])).toBe(true);
        const read = readDict(bytes);
        expect(read["00104000"].Value).toEqual(["Zoë é"]);
        // a number in a text VR is written as its text
        expect(read["00100020"].Value).toEqual(["12345"]);
    });

    it("user: a character outside a single-byte charset throws, or writes ? with ignoreErrors (REG-U-13)", () => {
        const dict = {
            "00080005": { vr: "CS", Value: ["ISO_IR 100"] },
            "00104000": { vr: "LT", Value: ["a日b"] }
        };
        expect(() => writePart10(dict)).toThrow(/U\+65E5/);

        const dicomDict = new DicomDict({
            "00020010": { vr: "UI", Value: [EXPLICIT_LITTLE_ENDIAN] }
        });
        dicomDict.dict = dict;
        const bytes = new Uint8Array(
            dicomDict.write({ allowInvalidVRLength: false, ignoreErrors: true })
        );
        expect(containsBytes(bytes, [0x61, 0x3f, 0x62])).toBe(true);
    });

    it("API: a registered custom term round-trips", () => {
        registerCharacterSet("VENDOR GREEK", { label: "iso-8859-7" });
        const bytes = writePart10({
            "00080005": { vr: "CS", Value: ["VENDOR GREEK"] },
            "00104000": { vr: "LT", Value: ["Ωμέγα"] }
        });
        // Ω is 0xD9 in ISO 8859-7
        expect(containsBytes(bytes, [0xd9, 0xec])).toBe(true);
        expect(readDict(bytes)["00104000"].Value).toEqual(["Ωμέγα"]);
    });

    it("user: an item-level charset does not leak to the next item or element", () => {
        const bytes = writePart10({
            "00080005": { vr: "CS", Value: ["ISO_IR 100"] },
            "00081115": {
                vr: "SQ",
                Value: [
                    {
                        "00080005": { vr: "CS", Value: ["ISO_IR 192"] },
                        "0008103E": { vr: "LO", Value: ["Aé1"] }
                    },
                    { "0008103E": { vr: "LO", Value: ["Bé2"] } }
                ]
            },
            "00104000": { vr: "LT", Value: ["Cé3"] }
        });
        expect(containsBytes(bytes, [0x41, 0xc3, 0xa9, 0x31])).toBe(true);
        expect(containsBytes(bytes, [0x42, 0xe9, 0x32])).toBe(true);
        expect(containsBytes(bytes, [0x43, 0xe9, 0x33])).toBe(true);
    });

    it("user: StreamingPart10Writer scopes an item-level charset to its item (REG-I-19)", async () => {
        const writer = new StreamingPart10Writer();
        await fromDataSet(
            {
                meta: {
                    "00020010": { vr: "UI", Value: [EXPLICIT_LITTLE_ENDIAN] }
                },
                dict: {
                    "00080005": { vr: "CS", Value: ["ISO_IR 100"] },
                    "00081115": {
                        vr: "SQ",
                        Value: [
                            {
                                "00080005": { vr: "CS", Value: ["ISO_IR 192"] },
                                "0008103E": { vr: "LO", Value: ["Aé1"] }
                            },
                            { "0008103E": { vr: "LO", Value: ["Bé2"] } }
                        ]
                    },
                    "00104000": { vr: "LT", Value: ["Cé3"] }
                }
            },
            writer
        );
        const bytes = new Uint8Array(writer.toArrayBuffer());
        expect(containsBytes(bytes, [0x41, 0xc3, 0xa9, 0x31])).toBe(true);
        expect(containsBytes(bytes, [0x42, 0xe9, 0x32])).toBe(true);
        expect(containsBytes(bytes, [0x43, 0xe9, 0x33])).toBe(true);
    });
});
