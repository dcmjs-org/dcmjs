import dcmjs from "../src/index.js";
import { AsyncDicomReader } from "../src/AsyncDicomReader.js";
import {
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN
} from "../src/constants/dicom.js";

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;

const CASES = [
    {
        vr: "ST",
        tag: "00080081",
        keyword: "InstitutionAddress",
        value: "Dept A\\Floor 2\\Room 10"
    },
    {
        vr: "LT",
        tag: "00104000",
        keyword: "PatientComments",
        value: "Line 1\\Line 2"
    },
    {
        vr: "UT",
        tag: "0040A160",
        keyword: "TextValue",
        value: "C:\\Studies\\scan1\\report"
    },
    {
        vr: "UR",
        tag: "00081190",
        keyword: "RetrieveURL",
        value: "https://example.org/a\\bc"
    }
];

function buildBuffer(transferSyntax, entries) {
    const dicomDict = new DicomDict({
        "00020010": { vr: "UI", Value: [transferSyntax] },
        "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.88.11"] },
        "00020003": { vr: "UI", Value: ["1.2.3.4"] }
    });
    dicomDict.dict = {
        "00080008": { vr: "CS", Value: ["ORIGINAL", "PRIMARY"] },
        ...entries
    };
    return dicomDict.write();
}

describe("Single-value text and URI VRs (PS3.5 Section 6.2 and 6.4)", () => {
    test.each([
        ["Explicit VR Little Endian", EXPLICIT_LITTLE_ENDIAN],
        ["Implicit VR Little Endian", IMPLICIT_LITTLE_ENDIAN]
    ])(
        "DicomMessage.readFile preserves backslashes in ST, LT, UT, UR (%s)",
        (_label, transferSyntax) => {
            const entries = Object.fromEntries(
                CASES.map(({ tag, vr, value }) => [tag, { vr, Value: [value] }])
            );
            const buffer = buildBuffer(transferSyntax, entries);
            const parsed = DicomMessage.readFile(buffer);
            const naturalized = DicomMetaDictionary.naturalizeDataset(
                parsed.dict
            );

            for (const { tag, keyword, value } of CASES) {
                expect(parsed.dict[tag].Value).toEqual([value]);
                expect(naturalized[keyword]).toEqual(value);
            }
            // Multi-valued VRs like CS still split on backslash.
            expect(parsed.dict["00080008"].Value).toEqual([
                "ORIGINAL",
                "PRIMARY"
            ]);
        }
    );

    test("AsyncDicomReader preserves backslashes in ST, LT, UT, UR", async () => {
        const entries = Object.fromEntries(
            CASES.map(({ tag, vr, value }) => [tag, { vr, Value: [value] }])
        );
        const buffer = buildBuffer(EXPLICIT_LITTLE_ENDIAN, entries);

        const reader = new AsyncDicomReader();
        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();
        const { dict } = await reader.readFile();

        for (const { tag, value } of CASES) {
            expect(dict[tag].Value).toEqual([value]);
        }
        expect(dict["00080008"].Value).toEqual(["ORIGINAL", "PRIMARY"]);
    });
});
