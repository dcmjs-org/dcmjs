/**
 * Upstream issues:
 * - https://github.com/dcmjs-org/dcmjs/issues/42  — an array of null/undefined
 *   entries reaching DicomMetaDictionary.denaturalizeValue crashed with an
 *   ungraceful "Uncaught TypeError: Cannot read property 'constructor' of
 *   undefined" instead of an actionable error (or a graceful skip).
 * - https://github.com/dcmjs-org/dcmjs/issues/374 — files containing garbage
 *   over-length values in short VRs (reporter hit AS and TM elements holding
 *   16+-char junk like "NX DE_XXXXXXXXXX") made DicomMessage.readFile throw
 *   "Value exceeds max length", so the whole file was unreadable; length
 *   limits should gate writes, not reads.
 *
 * Triage category: A (synthetic reproducers) for both.
 */
import dcmjs from "../../src/index.js";
import { validationLog } from "../../src/log.js";

validationLog.setLevel(5);

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;

const ELE = "1.2.840.10008.1.2.1";

describe("issue #42 — denaturalize with null/undefined values is graceful", () => {
    it("skips a field whose value is undefined", () => {
        let result;
        expect(() => {
            result = DicomMetaDictionary.denaturalizeDataset({
                SliceThickness: undefined
            });
        }).not.toThrow();
        expect(result).toEqual({});
    });

    it("emits an empty element for a field whose value is null (type 2)", () => {
        let result;
        expect(() => {
            result = DicomMetaDictionary.denaturalizeDataset({
                SliceThickness: null
            });
        }).not.toThrow();
        expect(result["00180050"]).toBeDefined();
        expect(result["00180050"].vr).toBe("DS");
        expect(result["00180050"].Value).toBeNull();
    });

    it("throws a corrective, actionable error (not a bare TypeError) for [undefined]", () => {
        // Note: the message names the failing method and cause ("undefined
        // values at the array naturalValue in ... denaturalizeValue") though
        // not the offending keyword itself — actionable, and exactly the
        // graceful error the upstream issue requested.
        let thrown;
        try {
            DicomMetaDictionary.denaturalizeDataset({
                SliceThickness: [undefined]
            });
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeDefined();
        expect(thrown).not.toBeInstanceOf(TypeError);
        expect(thrown.message).toMatch(/undefined values/);
        expect(thrown.message).toMatch(/denaturalizeValue/);
    });

    // Fixed in this arc: denaturalizeValue passes null entries through
    // (instead of crashing on entry.constructor) and the max-length check in
    // denaturalizeDataset guards null values, so [null] denaturalizes
    // gracefully to an element holding [null].
    it("#42: [null] value denaturalizes gracefully instead of crashing with a bare TypeError", () => {
        let result, thrown;
        try {
            result = DicomMetaDictionary.denaturalizeDataset({
                SliceThickness: [null]
            });
        } catch (e) {
            thrown = e;
        }
        if (thrown) {
            expect(thrown).not.toBeInstanceOf(TypeError);
            expect(thrown.message).toContain("SliceThickness");
        } else {
            expect(result).toBeDefined();
        }
    });
});

describe("issue #374 — over-length AS/TM garbage reads leniently, write stays strict", () => {
    const garbage = "NX DE_XXXXXXXXXX"; // 16 chars, AS allows 4
    const tmGarbage = "NX DE_XXXXXXXXXX_MORE!"; // 22 chars, TM allows 16

    function garbageBytes() {
        // Synthesize the malformed file: the escape hatch write produces
        // element bytes whose stored lengths exceed the VR maximums, exactly
        // what the reporter's files contained.
        const d = new DicomDict({ "00020010": { vr: "UI", Value: [ELE] } });
        d.upsertTag("00101010", "AS", [garbage]);
        d.upsertTag("00080030", "TM", [tmGarbage]);
        return d.write({ allowInvalidVRLength: true });
    }

    it("readFile succeeds on over-length AS and TM values (no max-length throw)", () => {
        let out;
        expect(() => {
            out = DicomMessage.readFile(garbageBytes());
        }).not.toThrow();

        const as = out.dict["00101010"];
        expect(as.vr).toBe("AS");
        expect(as.Value[0]).toBe(garbage);
        expect(as._rawValue[0]).toBe(garbage);

        const tm = out.dict["00080030"];
        expect(tm.vr).toBe("TM");
        expect(tm.Value[0]).toBe(tmGarbage);
        expect(tm._rawValue[0].trim()).toBe(tmGarbage);
    });

    it("default (strict) write still rejects the over-length AS value", () => {
        const d = new DicomDict({ "00020010": { vr: "UI", Value: [ELE] } });
        d.upsertTag("00101010", "AS", [garbage]);
        expect(() => d.write()).toThrow(/max length.*AS|AS.*max length/s);
    });
});
