import dcmjs from "../src/index.js";
import { fromPart10 } from "../src/eventStream/fromPart10.js";
import { CollectorListener } from "../src/eventStream/CollectorListener.js";
import {
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN
} from "../src/constants/dicom.js";

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;

// PS3.5 6.2: ST, LT, UT and UR have VM 1, and a backslash is part of the value.
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

function writeFile(transferSyntax) {
    const dicomDict = new DicomDict({
        "00020010": { vr: "UI", Value: [transferSyntax] },
        "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.88.11"] },
        "00020003": { vr: "UI", Value: ["1.2.3.4"] }
    });
    dicomDict.dict = {
        "00080008": { vr: "CS", Value: ["ORIGINAL", "PRIMARY"] },
        ...Object.fromEntries(
            CASES.map(({ tag, vr, value }) => [tag, { vr, Value: [value] }])
        )
    };
    return dicomDict.write();
}

async function readAsync(buffer) {
    const reader = new AsyncDicomReader();
    reader.stream.addBuffer(buffer);
    reader.stream.setComplete();
    return (await reader.readFile()).dict;
}

async function readEventStream(buffer) {
    const listener = new CollectorListener();
    await fromPart10(buffer, listener);
    return listener.result.dict;
}

describe("ST, LT, UT and UR keep backslashes on read (#671)", () => {
    test.each([
        [
            "DicomMessage, explicit VR",
            EXPLICIT_LITTLE_ENDIAN,
            b => DicomMessage.readFile(b).dict
        ],
        [
            "DicomMessage, implicit VR",
            IMPLICIT_LITTLE_ENDIAN,
            b => DicomMessage.readFile(b).dict
        ],
        ["AsyncDicomReader", EXPLICIT_LITTLE_ENDIAN, readAsync],
        ["fromPart10", EXPLICIT_LITTLE_ENDIAN, readEventStream]
    ])("%s", async (_name, transferSyntax, read) => {
        const dict = await read(writeFile(transferSyntax));
        const naturalized = DicomMetaDictionary.naturalizeDataset(dict);

        for (const { tag, keyword, value } of CASES) {
            expect(dict[tag].Value).toEqual([value]);
            expect(naturalized[keyword]).toEqual(value);
        }
        // A multi-valued VR still splits on the backslash.
        expect(dict["00080008"].Value).toEqual(["ORIGINAL", "PRIMARY"]);
    });
});
