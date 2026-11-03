import dcmjs from "../../src/index.js";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { fromPart10 } from "../../src/eventStream/fromPart10";

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;

/** Part 10 bytes with zero-length string elements and one list with empty values. */
function part10(syntax) {
    const dict = new DicomDict({ "00020010": { vr: "UI", Value: [syntax] } });
    dict.dict = {
        "00080061": { vr: "CS", Value: [] }, // ModalitiesInStudy, VM 1-n
        "00100020": { vr: "LO", Value: [] }, // PatientID, VM 1
        "00104000": { vr: "LT", Value: [] }, // PatientComments, LT
        "00101000": { vr: "LO", Value: ["", "ab", "", "c"] } // OtherPatientIDs: \ab\\c
    };
    return dict.write();
}

const expected = {
    ModalitiesInStudy: [],
    PatientID: null,
    PatientComments: null,
    OtherPatientIDs: ["", "ab", "", "c"]
};

describe("a zero-length string element has no value (NAT-U-VAL-1, -2)", () => {
    test.each(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1"])(
        "the readers give no value, and both producers agree, %s",
        async syntax => {
            const read = DicomMessage.readFile(part10(syntax));
            expect(read.dict["00080061"].Value).toEqual([]);
            expect(read.dict["00104000"].Value).toEqual([]);
            expect(read.dict["00101000"].Value).toEqual(["", "ab", "", "c"]);
            expect(
                DicomMetaDictionary.naturalizeDataset(read.dict)
            ).toMatchObject(expected);

            const listener = new NaturalizedListener();
            const values = [];
            const value = listener.value.bind(listener);
            listener.value = (v, opts) => {
                values.push(v);
                return value(v, opts);
            };
            await fromPart10(part10(syntax), listener);
            expect(listener.result).toMatchObject(expected);
            expect(values.filter(v => v === "")).toHaveLength(2);
        }
    );
});
