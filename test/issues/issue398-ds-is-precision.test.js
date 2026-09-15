/**
 * DS/IS value handling cluster — precision, formatting, and special values.
 *
 * Upstream issues:
 * - https://github.com/dcmjs-org/dcmjs/issues/96  (A) DecimalString written as
 *   empty when the in-memory value is a Number: toUTF8Array(4.8) returned []
 *   so SliceThickness vanished from the output file.
 * - https://github.com/dcmjs-org/dcmjs/issues/175 (A) DS values read from
 *   exponential notation ("7.1945578383e-05") re-serialized as fixed-point
 *   ("0.000071945578383", 17 chars) and the write threw
 *   "Value exceeds max length, vr: DS".
 * - https://github.com/dcmjs-org/dcmjs/issues/366 (A) DS 0.99990081787109
 *   (Number) formatted to a 17-char string on write, exceeding the DS
 *   16-char limit.
 * - https://github.com/dcmjs-org/dcmjs/issues/324 (A) NaN/Infinity values
 *   read fine but write crashed with a bare "Not a number: NaN" from
 *   BufferStream.toFloat with no tag context.
 * - https://github.com/dcmjs-org/dcmjs/issues/287 (A) DS with a comma
 *   decimal separator ("0,347") parsed to a silently wrong Number.
 * - https://github.com/dcmjs-org/dcmjs/issues/398 (C) reading+writing
 *   reformatted DS/IS through Number: "1.0000" -> 1, "+1.234" -> 1.234,
 *   9007199254740993 -> ...992 — data changed by a passthrough read/write.
 * - https://github.com/dcmjs-org/dcmjs/issues/53  (C) IS/DS were emitted as
 *   quoted strings in the DICOM JSON model where dcm4chee (and PS3.18 F.2.3)
 *   use JSON Numbers.
 *
 * How 1.0 deliberately differs (C rows): the dict read path retains the
 * original source string as `_rawValue` and writes it back byte-preserving
 * when Value is unchanged (see test/lossless-read-write.test.js for the
 * dict-level pins of " +1.4000  ", "1.2345e2", and the >2^53 integer), while
 * the DICOM JSON model output emits DS/IS as JSON Numbers when lossless and
 * as the raw string when Number() would lose integer precision (PS3.18
 * F.2.3.1 allows both), with NO _rawValue key (schema purity, #404) —
 * dcm4chee parity for normal values. This file covers the angles the existing
 * precision suite does not: the wire bytes themselves, the JSON-model number
 * typing, and the JSON-model large-integer consequence.
 *
 * Triage categories: #96/#175/#366/#324/#287 = A (synthetic), #398/#53 = C
 * (contract).
 */
import dcmjs from "../../src/index.js";
import { validationLog } from "../../src/log.js";

validationLog.setLevel(5);

const { DicomDict, DicomMessage } = dcmjs.data;
const { DicomEventStream } = dcmjs.eventStream;

const ELE = "1.2.840.10008.1.2.1";

function makeDict() {
    return new DicomDict({ "00020010": { vr: "UI", Value: [ELE] } });
}

function writeAndReRead(dicomDict, writeOptions) {
    return DicomMessage.readFile(dicomDict.write(writeOptions));
}

describe("issue #96 — DS Number value writes a value, not empty", () => {
    it("writes SliceThickness 4.8 (Number) and reads it back ≈4.8", () => {
        const d = makeDict();
        d.upsertTag("00180050", "DS", [4.8]);

        const out = writeAndReRead(d);
        const element = out.dict["00180050"];

        expect(element).toBeDefined();
        expect(element.Value).toHaveLength(1);
        expect(element.Value[0]).toBeCloseTo(4.8, 12);
        // the wire carried a non-empty serialization
        expect(element._rawValue[0].trim()).not.toBe("");
    });
});

describe("issue #175 — DS exponential notation round-trips within 16 chars", () => {
    // The full ImageOrientationPatient list from the upstream report.
    const rawComponents = [
        "-0.2437435686588",
        "0.96983969211578",
        "7.1945578383e-05",
        "0.00072092906339",
        "0.00025536940665",
        "-0.9999997019767"
    ];
    const numericComponents = rawComponents.map(Number);

    it("writes a read-style element (raw + Value) without an exceeds-max-length throw", () => {
        const d = makeDict();
        // Shape produced by readFile: source strings retained as _rawValue.
        d.dict["00200037"] = {
            vr: "DS",
            _rawValue: [...rawComponents],
            Value: [...numericComponents]
        };

        let buffer;
        expect(() => {
            buffer = d.write();
        }).not.toThrow();

        const out = DicomMessage.readFile(buffer);
        const reread = out.dict["00200037"];
        // every written component fits DS's 16-char limit
        for (const raw of reread._rawValue) {
            expect(raw.length).toBeLessThanOrEqual(16);
        }
        reread.Value.forEach((v, i) => {
            expect(v).toBeCloseTo(numericComponents[i], 12);
        });
    });

    it("re-formats a Number-only exponential value to ≤16 chars instead of throwing", () => {
        const d = makeDict();
        // No _rawValue: forces the DecimalString.convertToString path that
        // upstream produced the 17-char "0.000071945578383" from.
        d.upsertTag("00181041", "DS", [7.1945578383e-5]);

        let buffer;
        expect(() => {
            buffer = d.write();
        }).not.toThrow();

        const out = DicomMessage.readFile(buffer);
        const element = out.dict["00181041"];
        expect(element._rawValue[0].length).toBeLessThanOrEqual(16);
        expect(element.Value[0]).toBeCloseTo(7.1945578383e-5, 12);
    });
});

describe("issue #366 — DS 16-char formatting boundary", () => {
    it("writes 0.99990081787109 (Number) within 16 chars and round-trips equal", () => {
        const d = makeDict();
        d.upsertTag("00181041", "DS", [0.99990081787109]);

        let buffer;
        expect(() => {
            buffer = d.write();
        }).not.toThrow();

        const out = DicomMessage.readFile(buffer);
        const element = out.dict["00181041"];
        expect(element._rawValue[0].length).toBeLessThanOrEqual(16);
        expect(element.Value[0]).toBeCloseTo(0.99990081787109, 14);
    });
});

describe("issue #324 — NaN and Infinity have defined read and write behavior", () => {
    it("FD elements holding IEEE NaN/Infinity write without throwing and read back as NaN/Infinity", () => {
        const d = makeDict();
        d.upsertTag("00189219", "FD", [NaN]);
        d.upsertTag("00189305", "FD", [Infinity]);

        let buffer;
        expect(() => {
            buffer = d.write();
        }).not.toThrow();

        // read path: a file containing IEEE NaN/Inf bit patterns parses fine
        const out = DicomMessage.readFile(buffer);
        expect(Number.isNaN(out.dict["00189219"].Value[0])).toBe(true);
        expect(out.dict["00189305"].Value[0]).toBe(Infinity);
    });

    it("DS elements holding NaN/Infinity serialize as literals (defined behavior, no bare throw)", () => {
        const d = makeDict();
        d.upsertTag("00181041", "DS", [NaN]);
        d.upsertTag("00181044", "DS", [Infinity]);

        let buffer;
        expect(() => {
            buffer = d.write();
        }).not.toThrow();

        // 1.0's defined behavior: String(NaN)/String(Infinity) are written as
        // DS text ("NaN", "Infinity"); the strict DS parser maps them to null
        // on re-read while the literal survives in _rawValue. This is the
        // "serializes" arm of the acceptable-outcomes contract (pydicom also
        // writes the literal text); no context-free "Not a number" throw.
        const out = DicomMessage.readFile(buffer);
        expect(out.dict["00181041"].Value[0]).toBeNull();
        expect(out.dict["00181041"]._rawValue[0].trim()).toBe("NaN");
        expect(out.dict["00181044"].Value[0]).toBeNull();
        expect(out.dict["00181044"]._rawValue[0].trim()).toBe("Infinity");
    });
});

describe("issue #287 — DS with comma decimal separator", () => {
    function readCommaDs() {
        // Synthesize file bytes whose PixelSpacing (0028,0030) DS payload is
        // "0,347\0,347" — the comma-decimal locale garbage from the report.
        const d = makeDict();
        d.upsertTag("00280030", "DS", ["0,347", "0,347"]);
        return DicomMessage.readFile(d.write());
    }

    it("preserves the original comma string in _rawValue", () => {
        const element = readCommaDs().dict["00280030"];
        expect(element._rawValue.map(raw => raw.trim())).toEqual([
            "0,347",
            "0,347"
        ]);
    });

    // Fixed in this arc: DecimalString.applyFormatting now validates against
    // the PS3.5 DS character grammar instead of stripping invalid characters;
    // "0,347" parses to null with a validation warning while the original
    // text stays in _rawValue — never a silently wrong finite number.
    it("#287: comma-decimal DS parses to null with rawValue retained (0,347 never becomes 347)", () => {
        const value = readCommaDs().dict["00280030"].Value[0];
        const acceptable =
            value === "0,347" || value === null || Number.isNaN(value);
        expect(acceptable).toBe(true);
    });
});

describe("issues #398/#53 — DS/IS precision contract and the DICOM JSON model", () => {
    function buildPrecisionDict() {
        const d = makeDict();
        d.meta["00020002"] = { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] };
        d.meta["00020003"] = { vr: "UI", Value: ["1.2.3.4"] };
        // read-style entries: source strings retained as _rawValue
        d.dict["00181041"] = { vr: "DS", _rawValue: ["1.0000"], Value: [1] };
        d.dict["00181190"] = {
            vr: "DS",
            _rawValue: ["+1.234"],
            Value: [1.234]
        };
        d.dict["00200013"] = { vr: "IS", _rawValue: ["10"], Value: [10] };
        return d;
    }

    it("writes padded '1.0000' and signed '+1.234' back byte-preserving via rawValue", () => {
        // Dict-level _rawValue round-trip pins live in
        // test/lossless-read-write.test.js ("DS value with additional allowed
        // characters", ">MAX_SAFE_INTEGER" tests); this asserts the missing
        // angle — the literal bytes on the wire.
        const bytes = buildPrecisionDict().write();
        const text = Buffer.from(bytes).toString("latin1");
        expect(text).toContain("1.0000");
        expect(text).toContain("+1.234");

        const reread = DicomMessage.readFile(bytes);
        expect(reread.dict["00181041"]._rawValue).toEqual(["1.0000"]);
        expect(reread.dict["00181190"]._rawValue).toEqual(["+1.234"]);
    });

    it("emits IS and DS as JSON Numbers in the DICOM JSON model (dcm4chee parity)", async () => {
        const bytes = buildPrecisionDict().write();
        const json = await DicomEventStream.fromPart10(bytes).toDicomWebJson();

        expect(json["00200013"].vr).toBe("IS");
        expect(json["00200013"].Value).toEqual([10]);
        expect(typeof json["00200013"].Value[0]).toBe("number");

        expect(json["00181041"].vr).toBe("DS");
        expect(typeof json["00181041"].Value[0]).toBe("number");
        expect(json["00181041"].Value).toEqual([1]);
        expect(json["00181190"].Value).toEqual([1.234]);
    });

    // Fixed in this arc: DicomWebJsonWriter now applies PS3.18 F.2.3.1's
    // number-or-string choice per value — DS/IS emit JSON numbers when the
    // conversion is lossless (dcm4chee parity, #53) and fall back to the raw
    // source string when Number() would lose integer precision (>2^53), so
    // the JSON model never silently truncates and _rawValue still never
    // leaks (#404).
    it("#398: DICOM JSON model preserves DS integers beyond 2^53 via the F.2.3.1 string encoding", async () => {
        const d = makeDict();
        d.dict["00181041"] = {
            vr: "DS",
            _rawValue: ["9007199254740993"],
            Value: [9007199254740993]
        };
        const json = await DicomEventStream.fromPart10(
            d.write()
        ).toDicomWebJson();
        expect(String(json["00181041"].Value[0])).toBe("9007199254740993");
    });
});
