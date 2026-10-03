// dcmjs must be imported first to initialise circular-dependency bindings
// (ValueRepresentation.setDicomMessageClass etc.) before any direct module
// imports fire their top-level evaluation.
import "../../src/index.js";

import { ValueRepresentation } from "../../src/ValueRepresentation.js";
import {
    resolveVrInstance,
    isParsedUnknownVr,
    shapeReadValues,
    retainRaw,
    classifyElement
} from "../../src/core/decodeCore.js";

// These suites cover the pure element-decode primitives with synthetic
// elements. Corpus-level coverage of the same functions (real fixtures,
// every transfer syntax) lives in the streaming reader's suite, which is
// where elements are produced once the vendored tokenizer is gone.

// ──────────────────────────────────────────────────────────────────────────────
// shapeReadValues
// ──────────────────────────────────────────────────────────────────────────────

describe("shapeReadValues", () => {
    test("string with VM_DELIMITER splits both values and rawValues", () => {
        const cs = ValueRepresentation.createByTypeString("CS");
        // VM delimiter is 0x5c = backslash
        const raw = "ORIGINAL\\PRIMARY";
        const val = "ORIGINAL\\PRIMARY";
        const { values, rawValues } = shapeReadValues(cs, raw, val);
        expect(values).toEqual(["ORIGINAL", "PRIMARY"]);
        expect(rawValues).toEqual(["ORIGINAL", "PRIMARY"]);
    });

    test("single-value string (no delimiter) keeps value as-is in an array", () => {
        const cs = ValueRepresentation.createByTypeString("CS");
        const raw = "CT";
        const val = "CT";
        const { values, rawValues } = shapeReadValues(cs, raw, val);
        // typeof string but no delimiter → dropPadByte(['CT']) = ['CT']
        expect(values).toEqual(["CT"]);
        expect(rawValues).toEqual(["CT"]);
    });

    test("LO (non-binary, not singleVR) with array input passes through arrays", () => {
        const lo = ValueRepresentation.createByTypeString("LO");
        // When value is already an array (e.g. multi-value from binary read
        // path) and not a string the first branch assigns directly
        const val = ["abc"];
        const raw = ["abc"];
        const { values, rawValues } = shapeReadValues(lo, raw, val);
        expect(values).toBe(val); // same reference
        expect(rawValues).toBe(raw);
    });

    test("SQ passthrough: values and rawValues are the same objects passed in", () => {
        const sq = ValueRepresentation.createByTypeString("SQ");
        const val = [{ "00100010": { vr: "PN", Value: ["Doe^John"] } }];
        const raw = val;
        const { values, rawValues } = shapeReadValues(sq, raw, val);
        expect(values).toBe(val);
        expect(rawValues).toBe(raw);
    });

    test("OW passthrough: values and rawValues are the buffer objects", () => {
        const ow = ValueRepresentation.createByTypeString("OW");
        const buf = new ArrayBuffer(16);
        const { values, rawValues } = shapeReadValues(ow, buf, buf);
        expect(values).toBe(buf);
        expect(rawValues).toBe(buf);
    });

    test("OB passthrough: same as OW", () => {
        const ob = ValueRepresentation.createByTypeString("OB");
        const buf = new ArrayBuffer(8);
        const { values, rawValues } = shapeReadValues(ob, buf, buf);
        expect(values).toBe(buf);
        expect(rawValues).toBe(buf);
    });

    // singleVRs (from DicomMessage) = ["SQ","OF","OW","OB","UN","LT"].
    // Elements falling to the `else` branch are those that ARE in singleVRs
    // but are NOT SQ, OW, or OB: UN, OF, LT.
    // For VRs whose storeRaw()===false (BinaryRepresentation: UN, OF),
    // vr.read() returns rawValue===undefined, giving _rawValue:[undefined].
    test("UN (singleVR, storeRaw=false): rawValues wraps undefined into array", () => {
        const un = ValueRepresentation.createByTypeString("UN");
        const buf = new ArrayBuffer(4);
        // rawValue=undefined because UN.storeRaw()===false
        const { values, rawValues } = shapeReadValues(un, undefined, buf);
        expect(values).toEqual([buf]);
        expect(rawValues).toEqual([undefined]);
    });

    test("OF (singleVR, storeRaw=false): rawValues wraps undefined into array", () => {
        const of_ = ValueRepresentation.createByTypeString("OF");
        const buf = new ArrayBuffer(8);
        const { values, rawValues } = shapeReadValues(of_, undefined, buf);
        expect(values).toEqual([buf]);
        expect(rawValues).toEqual([undefined]);
    });

    test("LT (singleVR, storeRaw=true): scalar-wraps both value and rawValue", () => {
        const lt = ValueRepresentation.createByTypeString("LT");
        const str = "free text";
        const { values, rawValues } = shapeReadValues(lt, str, str);
        expect(values).toEqual([str]);
        expect(rawValues).toEqual([str]);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// isParsedUnknownVr
// ──────────────────────────────────────────────────────────────────────────────

describe("isParsedUnknownVr", () => {
    test("createByTypeString returns singleton → NOT ParsedUnknownVr", () => {
        const sq = ValueRepresentation.createByTypeString("SQ");
        expect(isParsedUnknownVr(sq)).toBe(false);
    });

    test("createByTypeString for UN returns singleton → NOT ParsedUnknownVr", () => {
        const un = ValueRepresentation.createByTypeString("UN");
        expect(isParsedUnknownVr(un)).toBe(false);
    });

    test("parseUnknownVr creates a per-call instance → IS ParsedUnknownVr", () => {
        const pun = ValueRepresentation.parseUnknownVr("SQ");
        expect(isParsedUnknownVr(pun)).toBe(true);
    });

    test("parseUnknownVr for LO → IS ParsedUnknownVr", () => {
        const plo = ValueRepresentation.parseUnknownVr("LO");
        expect(isParsedUnknownVr(plo)).toBe(true);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// retainRaw
// ──────────────────────────────────────────────────────────────────────────────

describe("retainRaw", () => {
    test("returns producedValue when vr.storeRaw() is true", () => {
        const cs = ValueRepresentation.createByTypeString("CS");
        expect(cs.storeRaw()).toBe(true);
        expect(retainRaw({ forceStoreRaw: false }, cs, "raw")).toBe("raw");
    });

    test("returns undefined when vr.storeRaw() is false and forceStoreRaw is false", () => {
        const un = ValueRepresentation.createByTypeString("UN");
        expect(un.storeRaw()).toBe(false);
        expect(retainRaw({ forceStoreRaw: false }, un, "raw")).toBeUndefined();
    });

    test("returns producedValue when forceStoreRaw is true even if storeRaw is false", () => {
        const un = ValueRepresentation.createByTypeString("UN");
        expect(retainRaw({ forceStoreRaw: true }, un, "raw")).toBe("raw");
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// classifyElement
// ──────────────────────────────────────────────────────────────────────────────

describe("classifyElement", () => {
    test("real SQ singleton → sequence", () => {
        const sq = ValueRepresentation.createByTypeString("SQ");
        const el = { hadUndefinedLength: false, encapsulatedPixelData: false };
        expect(classifyElement(el, sq)).toBe("sequence");
    });

    test("real SQ singleton with hadUndefinedLength still → sequence (identity wins)", () => {
        const sq = ValueRepresentation.createByTypeString("SQ");
        const el = {
            hadUndefinedLength: true,
            encapsulatedPixelData: false,
            items: []
        };
        expect(classifyElement(el, sq)).toBe("sequence");
    });

    test("ParsedUnknownValue with dict VR SQ → NOT sequence", () => {
        // parseUnknownVr creates a per-call ParsedUnknownValue, not the singleton
        const pun = ValueRepresentation.parseUnknownVr("SQ");
        const el = {
            hadUndefinedLength: true,
            encapsulatedPixelData: false
        };
        // Not singleton → skip sequence; hadUndefinedLength, not encapsulated → eagerWindow
        expect(classifyElement(el, pun)).toBe("eagerWindow");
    });

    test("hadUndefinedLength + encapsulatedPixelData + non-ParsedUnknown VR → encapsulated", () => {
        const ow = ValueRepresentation.createByTypeString("OW");
        // OW is a singleton (createByTypeString) and not ParsedUnknownVr
        const el = {
            hadUndefinedLength: true,
            encapsulatedPixelData: true
        };
        expect(classifyElement(el, ow)).toBe("encapsulated");
    });

    test("hadUndefinedLength + encapsulatedPixelData + ParsedUnknownValue → eagerWindow", () => {
        const pun = ValueRepresentation.parseUnknownVr("OB");
        const el = {
            hadUndefinedLength: true,
            encapsulatedPixelData: true
        };
        expect(classifyElement(el, pun)).toBe("eagerWindow");
    });

    test("hadUndefinedLength only (no encapsulated) → eagerWindow", () => {
        const un = ValueRepresentation.createByTypeString("UN");
        const el = {
            hadUndefinedLength: true,
            encapsulatedPixelData: false
        };
        expect(classifyElement(el, un)).toBe("eagerWindow");
    });

    test("plain defined-length element → value", () => {
        const cs = ValueRepresentation.createByTypeString("CS");
        const el = { hadUndefinedLength: false, encapsulatedPixelData: false };
        expect(classifyElement(el, cs)).toBe("value");
    });

    test("OW defined-length → value", () => {
        const ow = ValueRepresentation.createByTypeString("OW");
        const el = { hadUndefinedLength: false };
        expect(classifyElement(el, ow)).toBe("value");
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// AD-1: resolveVrInstance is the single canonical implicit-VR contract
// (eager parity — defined-length elements are never data-peek-promoted)
// ──────────────────────────────────────────────────────────────────────────────

describe("AD-1: implicit-VR contract — no defined-length SQ promotion", () => {
    const implicitWindow = { implicit: true };

    test("implicit dict-miss, defined length → UN (el.items is framing metadata, ignored)", () => {
        // (2222,2222) is in no dictionary; the parser may populate el.items
        // via its framing peek, but the semantic contract ignores it for
        // defined lengths — eager never promoted these.
        const el = {
            tagValue: 0x22222222,
            hadUndefinedLength: false,
            items: [{}]
        };
        const vr = resolveVrInstance(el, implicitWindow);
        expect(vr.type).toBe("UN");
        expect(classifyElement(el, vr)).toBe("value");
    });

    test("implicit dict-miss, hadUndefinedLength → SQ (length rule, no peek)", () => {
        const el = { tagValue: 0x22222222, hadUndefinedLength: true };
        expect(resolveVrInstance(el, implicitWindow).type).toBe("SQ");
    });

    test("implicit private dict-miss, defined length → UN", () => {
        const el = { tagValue: 0x22212223, hadUndefinedLength: false };
        expect(resolveVrInstance(el, implicitWindow).type).toBe("UN");
    });
});

// ──────────────────────────────────────────────────────────────────────────────
