import fs from "fs";
import path from "path";

// dcmjs must be imported first to initialise circular-dependency bindings
// (ValueRepresentation.setDicomMessageClass etc.) before any direct module
// imports fire their top-level evaluation.
import dcmjs from "../../src/index.js";

import { ValueRepresentation } from "../../src/ValueRepresentation.js";
import {
    resolveVrInstance,
    isParsedUnknownVr,
    shapeReadValues,
    retainRaw,
    buildElementStream,
    decodeElementValues,
    decodeWithEagerReadTag,
    classifyElement,
    resolveCharacterSet,
    seedReadContext
} from "../../src/core/decodeCore.js";

const { DicomMessage } = dcmjs.data;

const REPO_ROOT = path.join(__dirname, "..", "..");
const PARSER_IMAGES_DIR = path.join(REPO_ROOT, "packages", "parser", "testImages");

function readFixtureBuffer(relPath) {
    const fullPath = path.join(REPO_ROOT, relPath);
    const data = fs.readFileSync(fullPath);
    // Return a detached ArrayBuffer so byteOffset === 0
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

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
// seedReadContext (structural: buffers & syntax)
// ──────────────────────────────────────────────────────────────────────────────

describe("seedReadContext — buffer identity and window structure", () => {
    test("plain ELE fixture: metaWindow and bodyWindow share the same ArrayBuffer", () => {
        const ab = readFixtureBuffer(
            "packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm"
        );
        const { dataSet, syntax, metaWindow, bodyWindow } = seedReadContext(ab);
        // The input is an ArrayBuffer; toUint8Array wraps it without copying.
        // parseDicom on a non-deflate file uses the same Uint8Array → same buffer.
        expect(metaWindow.arrayBuffer).toBe(bodyWindow.arrayBuffer);
        expect(syntax).toBe("1.2.840.10008.1.2.1"); // ELE
        expect(metaWindow.syntax).toBe("1.2.840.10008.1.2.1");
        expect(metaWindow.littleEndian).toBe(true);
        expect(metaWindow.implicit).toBe(false);
        expect(metaWindow.decoder).toBeNull();
        expect(bodyWindow.syntax).toBe("1.2.840.10008.1.2.1");
        expect(bodyWindow.littleEndian).toBe(true);
        expect(bodyWindow.implicit).toBe(false);
        expect(bodyWindow.decoder).toBeNull();
        expect(dataSet).toBeDefined();
        expect(dataSet.elements).toBeDefined();
    });

    test("implicit LE fixture: bodyWindow.implicit is true", () => {
        const ab = readFixtureBuffer(
            "packages/parser/testImages/CT1_UNC.implicit_little_endian.dcm"
        );
        const { syntax, bodyWindow } = seedReadContext(ab);
        expect(syntax).toBe("1.2.840.10008.1.2"); // ILE
        expect(bodyWindow.implicit).toBe(true);
        expect(bodyWindow.littleEndian).toBe(true);
    });

    test("explicit BE fixture: bodyWindow.littleEndian is false", () => {
        const ab = readFixtureBuffer(
            "packages/parser/testImages/CT1_UNC.explicit_big_endian.dcm"
        );
        const { syntax, bodyWindow } = seedReadContext(ab);
        expect(syntax).toBe("1.2.840.10008.1.2.2"); // EBE
        expect(bodyWindow.littleEndian).toBe(false);
        expect(bodyWindow.implicit).toBe(false);
    });

    test("deflate fixture: metaWindow uses original buffer; bodyWindow uses post-inflate buffer", () => {
        const ab = readFixtureBuffer(
            "packages/parser/testImages/deflate/image_dfl"
        );
        const { metaWindow, bodyWindow, syntax } = seedReadContext(ab);
        // metaWindow points at original compressed input
        expect(metaWindow.arrayBuffer).toBe(ab);
        // bodyWindow points at the inflated buffer produced by pakoInflater
        expect(bodyWindow.arrayBuffer).not.toBe(ab);
        // _normalizeSyntax maps DEFLATED_ELE → ELE (only ILE/ELE/EBE pass through)
        expect(syntax).toBe("1.2.840.10008.1.2.1");
        expect(bodyWindow.syntax).toBe("1.2.840.10008.1.2.1");
        expect(bodyWindow.littleEndian).toBe(true);
        expect(bodyWindow.implicit).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// resolveVrInstance, buildElementStream, decodeElementValues
// Integration: drive against real fixture, compare with DicomMessage.readFile
// ──────────────────────────────────────────────────────────────────────────────

describe("resolveVrInstance + buildElementStream + decodeElementValues — ELE fixture", () => {
    const ab = readFixtureBuffer(
        "packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm"
    );
    let eagerResult;
    let seedCtx;
    const policy = { forceStoreRaw: false, noCopy: false, ignoreErrors: false };

    beforeAll(() => {
        eagerResult = DicomMessage.readFile(ab, { core: "eager" });
        seedCtx = seedReadContext(ab);
    });

    test("resolveVrInstance on a meta UI element returns UI VR", () => {
        const el = seedCtx.dataSet.elements.x00020010; // TransferSyntaxUID
        const vr = resolveVrInstance(el, seedCtx.metaWindow);
        expect(vr.type).toBe("UI");
    });

    test("decodeElementValues on TransferSyntaxUID returns ELE syntax string", () => {
        const el = seedCtx.dataSet.elements.x00020010;
        const vrInstance = resolveVrInstance(el, seedCtx.metaWindow);
        const { values } = decodeElementValues(
            seedCtx.metaWindow,
            el,
            vrInstance,
            policy
        );
        expect(values[0]).toBe("1.2.840.10008.1.2.1");
    });

    test("body CS element matches eager output", () => {
        // 00080060 Modality (CS)
        const key = "x00080060";
        const el = seedCtx.dataSet.elements[key];
        if (!el) return; // skip if not in this fixture
        const vrInstance = resolveVrInstance(el, seedCtx.bodyWindow);
        expect(vrInstance.type).toBe("CS");
        const { values } = decodeElementValues(
            seedCtx.bodyWindow,
            el,
            vrInstance,
            policy
        );
        const eagerValues = eagerResult.dict["00080060"]?.Value ?? [];
        expect(values).toEqual(eagerValues);
    });

    test("body US element (Rows) matches eager output", () => {
        // 00280010 Rows (US)
        const el = seedCtx.dataSet.elements.x00280010;
        if (!el) return;
        const vrInstance = resolveVrInstance(el, seedCtx.bodyWindow);
        expect(vrInstance.type).toBe("US");
        const { values } = decodeElementValues(
            seedCtx.bodyWindow,
            el,
            vrInstance,
            policy
        );
        const eagerValues = eagerResult.dict["00280010"]?.Value ?? [];
        expect(values).toEqual(eagerValues);
    });

    test("buildElementStream returns a stream whose position covers the element data", () => {
        const el = seedCtx.dataSet.elements.x00020010;
        const stream = buildElementStream(seedCtx.metaWindow, el, policy);
        expect(stream).toBeDefined();
        // The stream should be readable (has a size or position property)
        expect(typeof stream.size).toBe("number");
    });
});

describe("resolveVrInstance + decodeElementValues — implicit LE fixture", () => {
    const ab = readFixtureBuffer(
        "packages/parser/testImages/CT1_UNC.implicit_little_endian.dcm"
    );
    let eagerResult;
    let seedCtx;
    const policy = { forceStoreRaw: false, noCopy: false, ignoreErrors: false };

    beforeAll(() => {
        eagerResult = DicomMessage.readFile(ab, { core: "eager" });
        seedCtx = seedReadContext(ab);
    });

    test("implicit body element: resolveVrInstance does dictionary lookup", () => {
        // 00280010 Rows — should resolve to US via dictionary
        const el = seedCtx.dataSet.elements.x00280010;
        if (!el) return;
        const vrInstance = resolveVrInstance(el, seedCtx.bodyWindow);
        expect(vrInstance.type).toBe("US");
    });

    test("implicit body US values match eager", () => {
        const el = seedCtx.dataSet.elements.x00280010;
        if (!el) return;
        const vrInstance = resolveVrInstance(el, seedCtx.bodyWindow);
        const { values } = decodeElementValues(
            seedCtx.bodyWindow,
            el,
            vrInstance,
            policy
        );
        const eagerValues = eagerResult.dict["00280010"]?.Value ?? [];
        expect(values).toEqual(eagerValues);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// decodeWithEagerReadTag
// ──────────────────────────────────────────────────────────────────────────────

describe("decodeWithEagerReadTag", () => {
    const ab = readFixtureBuffer(
        "packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm"
    );
    let eagerResult;
    let seedCtx;
    const policy = { forceStoreRaw: false, noCopy: false, ignoreErrors: false };

    beforeAll(() => {
        eagerResult = DicomMessage.readFile(ab, { core: "eager" });
        seedCtx = seedReadContext(ab);
    });

    test("eager-reads a meta UI element and returns the transfer syntax", () => {
        const el = seedCtx.dataSet.elements.x00020010; // TransferSyntaxUID
        const { values } = decodeWithEagerReadTag(
            seedCtx.metaWindow,
            el,
            policy
        );
        expect(values[0]).toBe("1.2.840.10008.1.2.1");
    });

    test("result matches decodeElementValues for defined-length elements", () => {
        // 00080060 Modality — pick a simple CS element
        const el = seedCtx.dataSet.elements.x00080060;
        if (!el || el.hadUndefinedLength) return;
        const vrInstance = resolveVrInstance(el, seedCtx.bodyWindow);
        const fromEager = decodeWithEagerReadTag(
            seedCtx.bodyWindow,
            el,
            policy
        );
        const fromDirect = decodeElementValues(
            seedCtx.bodyWindow,
            el,
            vrInstance,
            policy
        );
        expect(fromEager.values).toEqual(fromDirect.values);
    });

    test("forceStoreRaw policy populates rawValues", () => {
        // 00080060 Modality — CS element with no special storeRaw handling
        const el = seedCtx.dataSet.elements.x00080060;
        if (!el || el.hadUndefinedLength) return;
        const policyWithForceRaw = { forceStoreRaw: true, noCopy: false, ignoreErrors: false };
        const fromEager = decodeWithEagerReadTag(
            seedCtx.bodyWindow,
            el,
            policyWithForceRaw
        );
        // With forceStoreRaw, rawValues should be populated as array
        expect(fromEager.rawValues).toBeDefined();
        expect(Array.isArray(fromEager.rawValues)).toBe(true);
        expect(fromEager.rawValues.length).toBeGreaterThan(0);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// resolveCharacterSet
// ──────────────────────────────────────────────────────────────────────────────

describe("resolveCharacterSet", () => {
    // Build a tiny DICOM with a known SpecificCharacterSet element and parse it
    // via seedReadContext so we have a real csEl to pass in.
    const { DicomDict } = dcmjs.data;

    function buildBufferWithCharset(charsetValue) {
        const meta = {
            "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] },
            "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
            "00020003": { vr: "UI", Value: ["1.2.3.4.5.6.7.8.9"] }
        };
        const dict = {
            "00080005": { vr: "CS", Value: [charsetValue] },
            "00100010": { vr: "PN", Value: ["Test^Patient"] }
        };
        const dd = new DicomDict(meta);
        dd.dict = dict;
        return dd.write();
    }

    test("returns null when csEl is null/undefined", () => {
        // Any window works; we pass null as the element
        const win = {
            arrayBuffer: new ArrayBuffer(0),
            baseOffset: 0,
            syntax: "1.2.840.10008.1.2.1",
            littleEndian: true,
            implicit: false,
            decoder: null
        };
        const result = resolveCharacterSet(win, null, {
            forceStoreRaw: false,
            noCopy: false,
            ignoreErrors: false
        });
        expect(result).toBeNull();
    });

    test("UTF-8 charset: returns TextDecoder and correct seedState", () => {
        const buf = buildBufferWithCharset("ISO_IR 192");
        const { dataSet, bodyWindow } = seedReadContext(buf);
        const csEl = dataSet.elements.x00080005;
        expect(csEl).toBeDefined();
        const policy = {
            forceStoreRaw: false,
            noCopy: false,
            ignoreErrors: false
        };
        const result = resolveCharacterSet(bodyWindow, csEl, policy);
        expect(result).not.toBeNull();
        expect(result.decoder).toBeInstanceOf(TextDecoder);
        expect(result.decoder.encoding).toBe("utf-8");
        // seedState rewrites values to ["ISO_IR 192"]
        expect(result.seedState.values).toEqual(["ISO_IR 192"]);
        // originalValues is what was actually in the file
        expect(result.originalValues[0]).toBe("ISO_IR 192");
    });

    test("latin1 charset (empty string): returns TextDecoder for latin1", () => {
        const buf = buildBufferWithCharset("");
        const { dataSet, bodyWindow } = seedReadContext(buf);
        const csEl = dataSet.elements.x00080005;
        const policy = {
            forceStoreRaw: false,
            noCopy: false,
            ignoreErrors: false
        };
        const result = resolveCharacterSet(bodyWindow, csEl, policy);
        expect(result).not.toBeNull();
        expect(result.decoder).toBeInstanceOf(TextDecoder);
    });

    test("does not mutate the window object", () => {
        const buf = buildBufferWithCharset("ISO_IR 192");
        const { dataSet, bodyWindow } = seedReadContext(buf);
        const csEl = dataSet.elements.x00080005;
        const win = { ...bodyWindow };
        const policy = {
            forceStoreRaw: false,
            noCopy: false,
            ignoreErrors: false
        };
        resolveCharacterSet(win, csEl, policy);
        // The passed-in window should not have been mutated
        expect(win.decoder).toBeNull();
    });

    test("unsupported charset + ignoreErrors=false throws", () => {
        const buf = buildBufferWithCharset("ISO_IR 999_BOGUS");
        const { dataSet, bodyWindow } = seedReadContext(buf);
        const csEl = dataSet.elements.x00080005;
        const policy = {
            forceStoreRaw: false,
            noCopy: false,
            ignoreErrors: false
        };
        expect(() => resolveCharacterSet(bodyWindow, csEl, policy)).toThrow(
            /Unsupported character set/
        );
    });

    test("unsupported charset + ignoreErrors=true warns but does not throw", () => {
        const buf = buildBufferWithCharset("ISO_IR 999_BOGUS");
        const { dataSet, bodyWindow } = seedReadContext(buf);
        const csEl = dataSet.elements.x00080005;
        const policy = {
            forceStoreRaw: false,
            noCopy: false,
            ignoreErrors: true
        };
        // Should not throw; decoder should be null/absent (unsupported, not set)
        let result;
        expect(() => {
            result = resolveCharacterSet(bodyWindow, csEl, policy);
        }).not.toThrow();
        // decoder is null because the coding was not recognized
        expect(result.decoder == null).toBe(true);
        // seedState is still returned
        expect(result.seedState).toBeDefined();
        expect(result.seedState.values).toEqual(["ISO_IR 192"]);
    });

    test("returns vrInstance that is a CS VR", () => {
        const buf = buildBufferWithCharset("ISO_IR 192");
        const { dataSet, bodyWindow } = seedReadContext(buf);
        const csEl = dataSet.elements.x00080005;
        const policy = {
            forceStoreRaw: false,
            noCopy: false,
            ignoreErrors: false
        };
        const result = resolveCharacterSet(bodyWindow, csEl, policy);
        expect(result.vrInstance).toBeDefined();
        expect(result.vrInstance.type).toBe("CS");
    });
});
