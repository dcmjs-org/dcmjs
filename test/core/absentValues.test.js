/**
 * An element with no value is written with zero length (NAT-U-RT-7). DICOM
 * JSON gives such an element with no `Value` key; other producers give
 * `undefined`, `null`, `""` or `[]`. Each form, for each VR, must write.
 */
import dcmjs from "../../src/index.js";

const { DicomDict } = dcmjs.data;

const VRS = [
    "AE",
    "AS",
    "AT",
    "CS",
    "DA",
    "DS",
    "DT",
    "FD",
    "FL",
    "IS",
    "LO",
    "LT",
    "OB",
    "OD",
    "OF",
    "OL",
    "OV",
    "OW",
    "PN",
    "SH",
    "SL",
    "SQ",
    "SS",
    "ST",
    "SV",
    "TM",
    "UC",
    "UI",
    "UL",
    "UN",
    "UR",
    "US",
    "UT",
    "UV"
];
// Explicit VR with a reserved field and a 32-bit length (PS3.5 7.1.2)
const LONG_VRS = [
    "OB",
    "OD",
    "OF",
    "OL",
    "OV",
    "OW",
    "SQ",
    "SV",
    "UC",
    "UN",
    "UR",
    "UT",
    "UV"
];

const ABSENT = {
    "no Value key": {},
    "Value: undefined": { Value: undefined },
    "Value: null": { Value: null },
    'Value: ""': { Value: "" },
    "Value: []": { Value: [] },
    "Value: [undefined]": { Value: [undefined] }
};

const EXPLICIT = "1.2.840.10008.1.2.1";
const IMPLICIT = "1.2.840.10008.1.2";
const tagOf = i => `0011${(0x1000 + i).toString(16)}`;

/** The value length of each element of the dataset (after the meta group). */
function valueLengths(buffer, implicit) {
    const view = new DataView(buffer);
    // 128-byte preamble, "DICM", then (0002,0000) UL with the group length
    let offset = 132 + 12 + view.getUint32(140, true);
    const lengths = {};
    while (offset < view.byteLength) {
        const tag =
            view.getUint16(offset, true).toString(16).padStart(4, "0") +
            view
                .getUint16(offset + 2, true)
                .toString(16)
                .padStart(4, "0");
        let length;
        if (implicit) {
            length = view.getUint32(offset + 4, true);
            offset += 8;
        } else {
            const vr = String.fromCharCode(
                view.getUint8(offset + 4),
                view.getUint8(offset + 5)
            );
            if (LONG_VRS.includes(vr) || vr === "UN") {
                length = view.getUint32(offset + 8, true);
                offset += 12;
            } else {
                length = view.getUint16(offset + 6, true);
                offset += 8;
            }
        }
        if (length === 0xffffffff) {
            // An empty sequence of undefined length: only its delimitation item
            expect(view.getUint32(offset, true)).toBe(0xe0ddfffe);
            expect(view.getUint32(offset + 4, true)).toBe(0);
            length = 0;
            offset += 8;
        }
        lengths[tag] = length;
        offset += length;
    }
    return lengths;
}

function write(syntax, element) {
    const dicomDict = new DicomDict({
        "00020010": { vr: "UI", Value: [syntax] }
    });
    dicomDict.dict = {};
    VRS.forEach((vr, i) => (dicomDict.dict[tagOf(i)] = { vr, ...element }));
    return dicomDict.write();
}

describe("an element with no value", () => {
    let warn;
    beforeEach(() => {
        warn = jest.spyOn(dcmjs.log, "warn").mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    for (const syntax of [EXPLICIT, IMPLICIT]) {
        for (const [form, element] of Object.entries(ABSENT)) {
            it(`writes ${form} with zero length for every VR (${syntax})`, () => {
                const lengths = valueLengths(
                    write(syntax, element),
                    syntax === IMPLICIT
                );
                expect(VRS.map((vr, i) => [vr, lengths[tagOf(i)]])).toEqual(
                    VRS.map(vr => [vr, 0])
                );
                // OL, OV and SV are not registered VRs yet: ignore that warning
                const warnings = warn.mock.calls.filter(
                    c => !/Invalid vr type/.test(c.join(" "))
                );
                expect(warnings).toEqual([]);
            });
        }
    }

    it("writes an undefined entry beside a value as a null entry", () => {
        const bytes = Value => {
            const dicomDict = new DicomDict({
                "00020010": { vr: "UI", Value: [EXPLICIT] }
            });
            dicomDict.dict = {
                "00101000": { vr: "LO", Value }, // OtherPatientIDs
                "00181310": { vr: "US", Value: Value.map(v => v && 3) } // AcquisitionMatrix
            };
            return new Uint8Array(dicomDict.write());
        };
        expect(bytes([undefined, "A"])).toEqual(bytes([null, "A"]));
    });

    it("writes a null sequence item as an empty item", () => {
        const bytes = Value => {
            const dicomDict = new DicomDict({
                "00020010": { vr: "UI", Value: [EXPLICIT] }
            });
            dicomDict.dict = { "00081110": { vr: "SQ", Value } }; // ReferencedStudySequence
            return new Uint8Array(dicomDict.write());
        };
        expect(bytes([null])).toEqual(bytes([{}]));
        expect(bytes([undefined, {}])).toEqual(bytes([{}, {}]));
    });
});
