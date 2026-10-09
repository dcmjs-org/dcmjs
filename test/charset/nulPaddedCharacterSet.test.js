import dcmjs from "../../src/index.js";
import { resolveCharsetDecoder } from "../../src/charset/iso2022.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMetaDictionary, DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;
const { DicomMetadataListener } = dcmjs.utilities;

// Some older modalities illegally pad odd-length SpecificCharacterSet values
// to even length with a NUL byte instead of the space required by the
// standard, e.g. "ISO 2022 IR 6\0". The NUL must not defeat the charset
// lookup (the pre-fix failure mode was "Unsupported character set:
// iso-2022-ir-6" with an invisible trailing NUL).

/** Part 10 buffer whose (0008,0005) is NUL-padded "ISO 2022 IR 6\0". */
function createNulPaddedSample() {
    const buffer = createSampleDicom({
        dict: {
            "00080005": { vr: "CS", Value: ["ISO 2022 IR 6"] },
            "00100010": { vr: "PN", Value: ["Test^Padding"] }
        }
    });

    // The writer pads the odd-length value with a space; replace that
    // padding with a NUL byte to reproduce the non-conformant files.
    const bytes = new Uint8Array(buffer);
    const spacePadded = Array.from("ISO 2022 IR 6 ", c => c.charCodeAt(0));
    const offset = bytes.findIndex((_, i) =>
        spacePadded.every((b, j) => bytes[i + j] === b)
    );
    expect(offset).toBeGreaterThan(-1);
    bytes[offset + spacePadded.length - 1] = 0x00;
    return buffer;
}

describe("NUL-padded SpecificCharacterSet", () => {
    test("resolveCharsetDecoder strips NUL padding", () => {
        const decoder = resolveCharsetDecoder(["ISO 2022 IR 6\0"]);
        expect(decoder).not.toBeNull();
        const bytes = new Uint8Array([0x41, 0x42, 0x43]); // "ABC"
        expect(decoder.decode(bytes)).toBe("ABC");
    });

    test("DicomMessage.readFile parses a NUL-padded file", () => {
        const dicomDict = DicomMessage.readFile(createNulPaddedSample());
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        expect(String(dataset.PatientName)).toEqual("Test^Padding");
        expect(dataset.SpecificCharacterSet).toEqual("ISO_IR 192");
    });

    test("AsyncDicomReader parses a NUL-padded file", async () => {
        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();

        reader.stream.addBuffer(Buffer.from(createNulPaddedSample()));
        reader.stream.setComplete();

        const { dict } = await reader.readFile({ listener });
        const dataset = DicomMetaDictionary.naturalizeDataset(dict);
        expect(String(dataset.PatientName)).toEqual("Test^Padding");
    });
});
