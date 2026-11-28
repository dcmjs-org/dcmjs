import dcmjs from "../src/index.js";

const { DicomDict, DicomMetaDictionary, DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;
const { DicomMetadataListener } = dcmjs.utilities;

DicomDict.setDicomMessageClass(DicomMessage);

describe("AsyncDicomReader with a SpecificCharacterSet declared in a sequence item", () => {
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

    function worklistPart10() {
        const dicomDict = new DicomDict({
            "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] }
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
            ReasonForTheRequestedProcedure: reason,
            // Longer than the 1 KB the reader waits for ahead of each
            // element, so input that comes in pieces is read while the last
            // pieces have yet to arrive.
            RequestedProcedureComments: "x".repeat(2048)
        });
        const data = new Uint8Array(dicomDict.write());
        replaceBytes(data, "QQQQQQ^QQQQ", iso8859_5(cyrillicName));
        replaceBytes(data, "WWWWWWW", iso8859_5(cyrillicMeaning));
        return data.buffer;
    }

    // dcmjs writes every sequence and item with undefined length. This
    // rewrites them with defined lengths, so the reader ends each item at its
    // length instead of at an Item Delimitation Item. After the preamble the
    // file is Explicit VR Little Endian throughout.
    function withDefinedLengths(buffer) {
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);
        const longVRs = ["OB", "OD", "OF", "OL", "OV", "OW", "SV", "UC"];
        longVRs.push("UN", "UR", "UT", "UV");
        const u32 = value => [
            value & 0xff,
            (value >> 8) & 0xff,
            (value >> 16) & 0xff,
            value >>> 24
        ];
        let pos = 132;

        // Copies the elements up to the end of the file or of the current
        // item, and returns their bytes.
        function elements() {
            const out = [];
            while (pos < bytes.length) {
                if (view.getUint16(pos, true) === 0xfffe) {
                    pos += 8; // Item Delimitation Item
                    break;
                }
                const vr = String.fromCharCode(bytes[pos + 4], bytes[pos + 5]);
                if (vr === "SQ") {
                    const header = Array.from(bytes.subarray(pos, pos + 8));
                    pos += 12;
                    const items = [];
                    while (view.getUint16(pos + 2, true) === 0xe000) {
                        pos += 8;
                        const item = elements();
                        items.push(0xfe, 0xff, 0x00, 0xe0);
                        items.push(...u32(item.length), ...item);
                    }
                    pos += 8; // Sequence Delimitation Item
                    out.push(...header, ...u32(items.length), ...items);
                } else {
                    const end = longVRs.includes(vr)
                        ? pos + 12 + view.getUint32(pos + 8, true)
                        : pos + 8 + view.getUint16(pos + 6, true);
                    out.push(...bytes.subarray(pos, end));
                    pos = end;
                }
            }
            return out;
        }

        const head = bytes.subarray(0, pos);
        return Uint8Array.from([...head, ...elements()]).buffer;
    }

    // Hands the file to the reader in 7-byte pieces, so item headers and the
    // SpecificCharacterSet values fall across pieces.
    async function* inPieces(buffer) {
        for (let at = 0; at < buffer.byteLength; at += 7) {
            yield new Uint8Array(buffer.slice(at, at + 7));
        }
    }

    async function readWorklist(buffer, pieces) {
        const reader = new AsyncDicomReader();
        let feeding;
        if (pieces) {
            feeding = reader.stream.fromAsyncStream(inPieces(buffer));
        } else {
            reader.stream.addBuffer(buffer);
            reader.stream.setComplete();
        }
        const { dict } = await reader.readFile({
            listener: new DicomMetadataListener()
        });
        await feeding;
        return DicomMetaDictionary.naturalizeDataset(dict);
    }

    it("builds the item's text in ISO 8859-5", () => {
        expect(
            new TextDecoder("iso-8859-5").decode(iso8859_5(cyrillicName))
        ).toEqual(cyrillicName);
    });

    it("rewrites every sequence and item with a defined length", () => {
        const undefinedLength = buffer => {
            const data = new Uint8Array(buffer);
            return data.some((_, i) =>
                [0, 1, 2, 3].every(j => data[i + j] === 0xff)
            );
        };
        expect(undefinedLength(worklistPart10())).toBe(true);
        expect(undefinedLength(withDefinedLengths(worklistPart10()))).toBe(
            false
        );
    });

    it.each([
        ["undefined lengths, one buffer", false, false],
        ["defined lengths, one buffer", true, false],
        ["undefined lengths, 7-byte pieces", false, true],
        ["defined lengths, 7-byte pieces", true, true]
    ])(
        "applies it only to that item and the items nested in it (%s)",
        async (_, defined, pieces) => {
            const part10 = defined
                ? withDefinedLengths(worklistPart10())
                : worklistPart10();
            const dataset = await readWorklist(part10, pieces);
            const [own, inherited] = dataset.ScheduledProcedureStepSequence;

            // One comparison, so a failure shows every value read in the wrong
            // character set at once.
            expect({
                patientName: dataset.PatientName[0].Alphabetic,
                ownItemName: own.ScheduledPerformingPhysicianName[0].Alphabetic,
                nestedItemMeaning:
                    own.ScheduledProtocolCodeSequence[0].CodeMeaning,
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
    );
});
