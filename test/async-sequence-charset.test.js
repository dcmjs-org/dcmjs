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
            ReasonForTheRequestedProcedure: reason
        });
        const data = new Uint8Array(dicomDict.write());
        replaceBytes(data, "QQQQQQ^QQQQ", iso8859_5(cyrillicName));
        replaceBytes(data, "WWWWWWW", iso8859_5(cyrillicMeaning));
        return data.buffer;
    }

    it("builds the item's text in ISO 8859-5", () => {
        expect(
            new TextDecoder("iso-8859-5").decode(iso8859_5(cyrillicName))
        ).toEqual(cyrillicName);
    });

    it("applies it only to that item and the items nested in it", async () => {
        const reader = new AsyncDicomReader();
        reader.stream.addBuffer(worklistPart10());
        reader.stream.setComplete();
        const { dict } = await reader.readFile({
            listener: new DicomMetadataListener()
        });
        const dataset = DicomMetaDictionary.naturalizeDataset(dict);
        const [own, inherited] = dataset.ScheduledProcedureStepSequence;

        // One comparison, so a failure shows every value read in the wrong
        // character set at once.
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
    });
});
