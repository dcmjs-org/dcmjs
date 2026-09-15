/**
 * Issue-derived regression tests — graceful behavior when the runtime's
 * TextDecoder does not support "latin1".
 *
 * Upstream issue:
 * - https://github.com/dcmjs-org/dcmjs/issues/297 (category A — synthetic)
 *   Symptom: on some mobile / embedded JS runtimes (e.g. react-native,
 *   older JavaScriptCore, Hermes without full ICU) `new
 *   TextDecoder("latin1")` throws `The "latin1" encoding is not
 *   supported`. ReadBufferStream constructs exactly that decoder, so
 *   dcmjs cannot read even a plain-ASCII file on those platforms. A
 *   graceful fallback (e.g. manual byte→char decode or utf-8 with
 *   fatal:false) would keep basic parsing working.
 *
 * Technique: the library module graph is re-required (jest.resetModules)
 * under a patched global.TextDecoder that supports utf-8 but throws for
 * latin1/windows-1252, mimicking the mobile runtimes in the report. The
 * sample Part 10 buffer is built FIRST with the normally-loaded modules,
 * so only the read side runs under the crippled runtime. The global is
 * restored in afterEach/finally.
 *
 * validationLog is silenced because the test deliberately sabotages the
 * runtime environment.
 */

// Imported for its side effect: src/index.js wires the circular
// Tag/ValueRepresentation/DicomDict ↔ DicomMessage references that
// createSampleDicom's write path depends on.
import "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";
import { validationLog } from "../../src/log.js";

validationLog.setLevel(5);

const RealTextDecoder = global.TextDecoder;

/** TextDecoder stand-in for latin1-less mobile runtimes. */
class MobileTextDecoder {
    constructor(label = "utf-8", options) {
        const normalized = String(label).toLowerCase();
        if (
            normalized !== "utf-8" &&
            normalized !== "utf8" &&
            normalized !== "unicode-1-1-utf-8"
        ) {
            throw new RangeError(`The "${label}" encoding is not supported`);
        }
        this._decoder = new RealTextDecoder(label, options);
    }
    decode(input, options) {
        return this._decoder.decode(input, options);
    }
    get encoding() {
        return this._decoder.encoding;
    }
}

afterEach(() => {
    global.TextDecoder = RealTextDecoder;
    jest.resetModules();
});

describe("issue #297 — TextDecoder without latin1 support (mobile runtimes)", () => {
    // Fixed in this arc: BufferStream builds its default decoder via the
    // guarded src/charset/latin1.js createLatin1Decoder(), which falls back
    // to a pure-JS byte→code-point decoder when the runtime's TextDecoder
    // rejects "latin1" — the library loads and plain files parse.
    it("#297: library loads and parses ASCII files without a latin1 TextDecoder (pure-JS fallback)", () => {
        // Build the file with the healthy, already-loaded module graph.
        const buffer = createSampleDicom(); // plain ASCII / latin1 content
        try {
            global.TextDecoder = MobileTextDecoder;
            jest.resetModules();
            // Fresh module graph under the crippled runtime — this is
            // where the RangeError is currently thrown.
            const fresh = require("../../src/index.js");
            const freshDcmjs = fresh.default ?? fresh;
            const dicomDict = freshDcmjs.data.DicomMessage.readFile(buffer);
            // Graceful-fallback contract: plain ASCII parses fine without
            // a latin1 TextDecoder.
            expect(dicomDict.dict["00280010"].Value).toEqual([32]); // Rows
            expect(dicomDict.dict["00280011"].Value).toEqual([64]); // Columns
        } finally {
            global.TextDecoder = RealTextDecoder;
            jest.resetModules();
        }
    });

    it("control: the same file parses under the real TextDecoder", () => {
        const buffer = createSampleDicom();
        const fresh = require("../../src/index.js");
        const freshDcmjs = fresh.default ?? fresh;
        const dicomDict = freshDcmjs.data.DicomMessage.readFile(buffer);
        expect(dicomDict.dict["00280010"].Value).toEqual([32]);
        expect(dicomDict.dict["00280011"].Value).toEqual([64]);
    });
});
