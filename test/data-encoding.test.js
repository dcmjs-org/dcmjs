import { getZippedTestDataset, readFileAsArrayBuffer } from "./testUtils.js";
import dcmjs from "../src/index.js";
import fsPromises from "fs/promises";
import path from "path";

const { DicomDict, DicomMetaDictionary, DicomMessage } = dcmjs.data;

const expectedPatientNames = {
    SCSARAB: "قباني^لنزار",
    SCSFREN: "Buc^Jérôme",
    SCSGERM: "Äneas^Rüdiger",
    SCSGREEK: "Διονυσιος",
    SCSHBRW: "שרון^דבורה",
    SCSRUSS: "Люкceмбypг",
    SCSX1: "Wang^XiaoDong=王^小東", // Trailing "=" gets stripped, as is permitted by the spec
    SCSX2: "Wang^XiaoDong=王^小东" // idem
    // These are not yet supported, because they use multiple encodings, which would require a more complex parser...
    //"SCSH31": "X",
    //"SCSH32": "X",
    //"SCSI2": "X",
};

it("test_encodings", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/dclunie-charsets/dclunie-charsets.zip";
    const unzipPath = await getZippedTestDataset(
        url,
        "dclunie-charsets.zip",
        "dclunie-charsets"
    );
    const filesPath = unzipPath + "/charsettests";
    const fileNames = await fsPromises.readdir(filesPath);

    fileNames.forEach(fileName => {
        if (fileName in expectedPatientNames) {
            const arrayBuffer = readFileAsArrayBuffer(
                path.join(filesPath, fileName)
            );
            const dicomDict = DicomMessage.readFile(arrayBuffer);
            const dataset = DicomMetaDictionary.naturalizeDataset(
                dicomDict.dict
            );
            expect(String(dataset.PatientName)).toEqual(
                expectedPatientNames[fileName]
            );

            // write to memory and expect correctly loaded utf-8 DICOM
            const newDicomDict = DicomMessage.readFile(dicomDict.write());
            const newDataset = DicomMetaDictionary.naturalizeDataset(
                newDicomDict.dict
            );
            expect(String(newDataset.PatientName)).toEqual(
                expectedPatientNames[fileName]
            );
            expect(newDataset.SpecificCharacterSet).toEqual("ISO_IR 192");
        }
    });
});

const EXPLICIT_LE = "1.2.840.10008.1.2.1";
const IMPLICIT_LE = "1.2.840.10008.1.2";

// dcmjs writes every sequence and item with undefined length. This rewrites
// them with defined lengths, so the reader takes each item's length instead of
// looking for its Item Delimitation Item. The file meta group is Explicit VR;
// the data set after it is Explicit or Implicit VR Little Endian.
function withDefinedLengths(buffer, syntax) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const longVRs = ["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "SV", "UC"];
    longVRs.push("UN", "UR", "UT", "UV");
    const u32 = value => [
        value & 0xff,
        (value >> 8) & 0xff,
        (value >> 16) & 0xff,
        value >>> 24
    ];
    // The meta group ends where its group length, (0002,0000) UL, says.
    let pos = 144 + view.getUint32(140, true);
    const head = bytes.subarray(0, pos);

    // Copies the elements up to the end of the file or of the current item,
    // and returns their bytes.
    function elements() {
        const out = [];
        while (pos < bytes.length) {
            if (view.getUint16(pos, true) === 0xfffe) {
                pos += 8; // Item Delimitation Item
                break;
            }
            const vr = String.fromCharCode(bytes[pos + 4], bytes[pos + 5]);
            let header = 8;
            let length = view.getUint16(pos + 6, true);
            if (syntax === IMPLICIT_LE) {
                length = view.getUint32(pos + 4, true);
            } else if (longVRs.includes(vr)) {
                header = 12;
                length = view.getUint32(pos + 8, true);
            }
            if (length === 0xffffffff) {
                // A sequence: tag, and in Explicit VR "SQ" and two bytes
                const tagAndVR = Array.from(
                    bytes.subarray(pos, pos + header - 4)
                );
                pos += header;
                const items = [];
                while (view.getUint16(pos + 2, true) === 0xe000) {
                    pos += 8;
                    const item = elements();
                    items.push(0xfe, 0xff, 0x00, 0xe0);
                    items.push(...u32(item.length), ...item);
                }
                pos += 8; // Sequence Delimitation Item
                out.push(...tagAndVR, ...u32(items.length), ...items);
            } else {
                out.push(...bytes.subarray(pos, pos + header + length));
                pos += header + length;
            }
        }
        return out;
    }

    return Uint8Array.from([...head, ...elements()]).buffer;
}

// The two transfer syntaxes dcmjs writes, each with the undefined lengths it
// writes and rewritten with defined lengths.
const encodings = [
    ["Explicit VR, undefined lengths", EXPLICIT_LE, false],
    ["Explicit VR, defined lengths", EXPLICIT_LE, true],
    ["Implicit VR, undefined lengths", IMPLICIT_LE, false],
    ["Implicit VR, defined lengths", IMPLICIT_LE, true]
];

function writePart10(dict, syntax) {
    const dicomDict = new DicomDict({
        "00020010": { vr: "UI", Value: [syntax] }
    });
    dicomDict.dict = dict;
    return dicomDict.write();
}

describe("Sequences rewritten with defined lengths", () => {
    const undefinedLength = buffer => {
        const data = new Uint8Array(buffer);
        return data.some((_, i) =>
            [0, 1, 2, 3].every(j => data[i + j] === 0xff)
        );
    };

    it.each([
        ["Explicit VR", EXPLICIT_LE],
        ["Implicit VR", IMPLICIT_LE]
    ])("keep no undefined length (%s)", (_, syntax) => {
        const part10 = writePart10(
            DicomMetaDictionary.denaturalizeDataset({
                SpecificCharacterSet: "ISO_IR 192",
                ContentSequence: [
                    {
                        TextValue: "a",
                        ContentSequence: [{ TextValue: "b" }]
                    }
                ]
            }),
            syntax
        );
        expect(undefinedLength(part10)).toBe(true);
        expect(undefinedLength(withDefinedLengths(part10, syntax))).toBe(false);
    });
});

describe("SpecificCharacterSet in data read from sub-streams", () => {
    const text = "lesione – café 肝";

    function writeAndRead(dict, syntax = EXPLICIT_LE, defined = false) {
        const part10 = writePart10(dict, syntax);
        return DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(
                defined ? withDefinedLengths(part10, syntax) : part10
            ).dict
        );
    }

    it.each(encodings)(
        "decodes text in sequence items at every depth (%s)",
        (_, syntax, defined) => {
            const dataset = writeAndRead(
                DicomMetaDictionary.denaturalizeDataset({
                    SpecificCharacterSet: "ISO_IR 192",
                    SOPClassUID: "1.2.840.10008.5.1.4.1.1.88.33",
                    SOPInstanceUID: "1.2.3",
                    StudyDescription: text,
                    ValueType: "CONTAINER",
                    ContentSequence: [
                        {
                            RelationshipType: "CONTAINS",
                            ValueType: "TEXT",
                            TextValue: text,
                            ContentSequence: [
                                {
                                    RelationshipType: "CONTAINS",
                                    ValueType: "TEXT",
                                    TextValue: text
                                }
                            ]
                        }
                    ]
                }),
                syntax,
                defined
            );

            expect(dataset.StudyDescription).toEqual(text);
            expect(dataset.ContentSequence[0].TextValue).toEqual(text);
            expect(
                dataset.ContentSequence[0].ContentSequence[0].TextValue
            ).toEqual(text);
        }
    );

    it("decodes text in UN elements read with their dictionary VR", () => {
        const dict = DicomMetaDictionary.denaturalizeDataset({
            SpecificCharacterSet: "ISO_IR 192",
            SOPClassUID: "1.2.840.10008.5.1.4.1.1.7",
            SOPInstanceUID: "1.2.3"
        });
        // StudyDescription is LO in the dictionary, stored here with explicit VR UN.
        // The bytes are the LO value, padded to even length with a space.
        dict["00081030"] = {
            vr: "UN",
            Value: [new TextEncoder().encode(`${text} `).buffer]
        };

        expect(writeAndRead(dict).StudyDescription).toEqual(text);
    });
});

describe("SpecificCharacterSet declared in a sequence item", () => {
    // PS3.5 7.5.3: a Specific Character Set in an item applies only to that
    // item, and the items nested in it; an item without one uses the
    // character set of the data set that contains it.
    //
    // A worklist-shaped data set in ISO_IR 192 whose first scheduled step
    // declares ISO_IR 144 (ISO 8859-5, Cyrillic). dcmjs always writes UTF-8,
    // so that item's text is written as ASCII placeholders of the same length
    // and then replaced with its ISO 8859-5 bytes.
    const cyrillicName = "Иванов^Петр";
    const cyrillicMeaning = "Рентген";
    const latinName = "Dupré^Anaïs";
    const reason = "Contrôle après opération";

    // ISO 8859-5 keeps ASCII and puts А..я (U+0410..U+044F) at 0xB0..0xEF.
    const iso8859_5 = value =>
        Uint8Array.from(value, c => {
            const code = c.codePointAt(0);
            return code < 0x80 ? code : code - 0x360;
        });

    function replaceBytes(data, placeholder, bytes) {
        const needle = new TextEncoder().encode(placeholder);
        const at = data.findIndex((_, i) =>
            needle.every((byte, j) => data[i + j] === byte)
        );
        expect(at).toBeGreaterThan(-1);
        data.set(bytes, at);
    }

    function worklistPart10(syntax) {
        const dicomDict = new DicomDict({
            "00020010": { vr: "UI", Value: [syntax] }
        });
        dicomDict.dict = DicomMetaDictionary.denaturalizeDataset({
            SpecificCharacterSet: "ISO_IR 192",
            PatientName: latinName,
            ScheduledProcedureStepSequence: [
                {
                    SpecificCharacterSet: "ISO_IR 144",
                    ScheduledPerformingPhysicianName: "QQQQQQ^QQQQ",
                    ScheduledProtocolCodeSequence: [
                        {
                            CodeValue: "XR",
                            CodingSchemeDesignator: "99LOCAL",
                            CodeMeaning: "WWWWWWW"
                        }
                    ]
                },
                { ScheduledPerformingPhysicianName: latinName }
            ],
            ReasonForTheRequestedProcedure: reason
        });
        const data = new Uint8Array(dicomDict.write());
        replaceBytes(data, "QQQQQQ^QQQQ", iso8859_5(cyrillicName));
        replaceBytes(data, "WWWWWWW", iso8859_5(cyrillicMeaning));
        return data.buffer;
    }

    // One comparison, so a failure shows every value read in the wrong
    // character set at once.
    function expectEachItemInItsCharacterSet(dataset) {
        const [own, inherited] = dataset.ScheduledProcedureStepSequence;
        expect({
            patientName: dataset.PatientName[0].Alphabetic,
            ownItemName: own.ScheduledPerformingPhysicianName[0].Alphabetic,
            nestedItemMeaning: own.ScheduledProtocolCodeSequence[0].CodeMeaning,
            nextItemName:
                inherited.ScheduledPerformingPhysicianName[0].Alphabetic,
            afterSequence: dataset.ReasonForTheRequestedProcedure
        }).toEqual({
            patientName: latinName,
            ownItemName: cyrillicName,
            nestedItemMeaning: cyrillicMeaning,
            nextItemName: latinName,
            afterSequence: reason
        });
    }

    it("builds the item's text in ISO 8859-5", () => {
        expect(
            new TextDecoder("iso-8859-5").decode(iso8859_5(cyrillicName))
        ).toEqual(cyrillicName);
    });

    it.each(encodings)(
        "applies only to that item and the items nested in it (%s)",
        (_, syntax, defined) => {
            const part10 = worklistPart10(syntax);
            expectEachItemInItsCharacterSet(
                DicomMetaDictionary.naturalizeDataset(
                    DicomMessage.readFile(
                        defined ? withDefinedLengths(part10, syntax) : part10
                    ).dict
                )
            );
        }
    );
});
