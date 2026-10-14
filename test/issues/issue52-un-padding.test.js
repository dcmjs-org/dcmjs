/**
 * Upstream issue: https://github.com/dcmjs-org/dcmjs/issues/52
 *
 * Symptom: the reporter was surprised that dcmjs padded an odd-length UN
 * value with a NUL byte, reading the 2013 edition of PS3.5 6.2 as allowing
 * NUL padding only for UI and OB.
 *
 * Triage category: C (contract assertion). How 1.0 deliberately differs
 * from the upstream report: current PS3.5 Table 6.2-1 explicitly pads UN
 * "as in the native format of the Value Representation" with a trailing
 * NULL byte like OB — the upstream report predates that clarification, so
 * NUL-padding UN to even length is the pinned, standard-conformant
 * contract here, not a bug.
 */
import dcmjs from "../../src/index.js";

const { DicomDict, DicomMessage } = dcmjs.data;

const ELE = "1.2.840.10008.1.2.1";
const ODD_CONTENT = [0x01, 0x02, 0x03, 0x04, 0x05];

describe("issue #52 — odd-length UN pads with NUL to even length", () => {
    function writeOddUn() {
        const d = new DicomDict({ "00020010": { vr: "UI", Value: [ELE] } });
        d.upsertTag("00090011", "UN", [new Uint8Array(ODD_CONTENT).buffer]);
        return new Uint8Array(d.write());
    }

    function findElementOffset(bytes) {
        // ELE little-endian header for (0009,0011): 09 00 11 00 'U' 'N'
        const sig = [0x09, 0x00, 0x11, 0x00, 0x55, 0x4e];
        for (let i = 0; i <= bytes.length - sig.length; i++) {
            if (sig.every((b, j) => bytes[i + j] === b)) {
                return i;
            }
        }
        return -1;
    }

    it("declares an even length on the wire and pads with 0x00", () => {
        const bytes = writeOddUn();
        const offset = findElementOffset(bytes);
        expect(offset).toBeGreaterThan(-1);

        // UN uses the 32-bit-length header: VR(2) + reserved(2) + length(4)
        const view = new DataView(bytes.buffer);
        const declaredLength = view.getUint32(offset + 8, true);
        expect(declaredLength).toBe(6); // 5 content bytes + 1 pad
        expect(declaredLength % 2).toBe(0);

        const valueStart = offset + 12;
        const value = Array.from(
            bytes.slice(valueStart, valueStart + declaredLength)
        );
        expect(value).toEqual([...ODD_CONTENT, 0x00]); // NUL pad, not space
    });

    it("round-trips: read back preserves the content and the even declared length", () => {
        const out = DicomMessage.readFile(writeOddUn().buffer);
        const element = out.dict["00090011"];

        expect(element.vr).toBe("UN");
        const readBack = new Uint8Array(element.Value[0]);
        // declared (padded, even) length is preserved by the read
        expect(readBack.length).toBe(6);
        expect(Array.from(readBack.slice(0, 5))).toEqual(ODD_CONTENT);
        expect(readBack[5]).toBe(0x00);
    });
});
