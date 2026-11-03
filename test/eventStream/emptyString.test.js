import dcmjs from "../../src/index.js";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { fromPart10 } from "../../src/eventStream/fromPart10";

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;

/** Part 10 bytes with zero-length string elements, which a reader gives as [""]. */
function part10(syntax) {
    const dict = new DicomDict({ "00020010": { vr: "UI", Value: [syntax] } });
    dict.dict = {
        "00080061": { vr: "CS", Value: [] }, // ModalitiesInStudy, VM 1-n
        "00100020": { vr: "LO", Value: [] }, // PatientID, VM 1
        "00101000": { vr: "LO", Value: ["A", ""] } // OtherPatientIDs: an empty value in a list stays
    };
    return dict.write();
}

const empty = {
    ModalitiesInStudy: [],
    PatientID: null,
    OtherPatientIDs: ["A", ""]
};

describe("a zero-length string element is empty (NAT-U-VAL-1, -2)", () => {
    test.each(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1"])(
        "naturalizeDataset and NaturalizedListener agree, %s",
        async syntax => {
            const read = DicomMessage.readFile(part10(syntax));
            expect(read.dict["00080061"].Value).toEqual([""]);
            const fromDict = DicomMetaDictionary.naturalizeDataset(read.dict);
            expect(fromDict).toMatchObject(empty);

            const listener = new NaturalizedListener();
            await fromPart10(part10(syntax), listener);
            expect(listener.result).toMatchObject(empty);
        }
    );

    test("an empty element writes back with zero length", () => {
        const ds = DicomMetaDictionary.naturalizeDataset({
            "00080061": { vr: "CS", Value: [""] },
            "00100020": { vr: "LO", Value: [""] }
        });
        const back = DicomMetaDictionary.denaturalizeDataset(ds);
        const dict = new DicomDict({
            "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] }
        });
        dict.dict = back;
        const reread = DicomMessage.readFile(dict.write()).dict;
        expect(reread["00080061"].Value).toEqual([""]);
        expect(reread["00100020"].Value).toEqual([""]);
    });
});
