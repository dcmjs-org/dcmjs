import fs from "fs";
import path from "path";
import {
    parseDicom,
    ByteStream,
    DataSet,
    littleEndianByteArrayParser,
    readDicomElementExplicit
} from "@dcmjs/parser";
import dcmjs from "../src/index.js";
import { isCleanForPassthrough } from "../src/lazy/LazyDicomReader.js";
import { log } from "../src/log.js";
import { compareSection } from "./helper/equivalence.js";

const { DicomMessage, DicomDict, DicomMetaDictionary } = dcmjs.data;

/**
 * Regression tests for the lazy-core hardening fixes (H2, M1-M4), including
 * the divergence-pinning tests for the documented error-timing differences,
 * and for the writer seam (W2: _sourceSpan, _dirty soundness,
 * isCleanForPassthrough, _lazyWriteContext - see the docblock in
 * src/lazy/LazyDicomReader.js).
 */

const FIXTURE_DIR = path.join(
    __dirname,
    "..",
    "packages",
    "parser",
    "testImages"
);

function toStandaloneArrayBuffer(data) {
    return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
    );
}

function readFixture(name) {
    return toStandaloneArrayBuffer(
        fs.readFileSync(path.join(FIXTURE_DIR, name))
    );
}

function readEager(buffer, options = {}) {
    return DicomMessage.readFile(buffer.slice(0), {
        ...options,
        core: "eager"
    });
}

function readLazy(buffer, options = {}) {
    return DicomMessage.readFile(buffer.slice(0), {
        ...options,
        core: "lazy"
    });
}

/**
 * log.warn call counter. jest.setup.js replaces the whole loglevel module
 * with persistent jest.fn() mocks whose history spans the test file, so
 * the assertions below count matching calls AFTER a recorded baseline
 * instead of spying fresh.
 */
function warnCallsContaining(needle, from) {
    return log.warn.mock.calls
        .slice(from)
        .filter(args => args.map(String).join(" ").includes(needle)).length;
}

// ---------------------------------------------------------------------------
// H2 - ignoreErrors during materialization
// ---------------------------------------------------------------------------
describe("H2: ignoreErrors honored during materialization", () => {
    /**
     * A file whose only defect is an unsupported SpecificCharacterSet
     * ('BOGUS!') INSIDE a sequence item. Eager hits it mid-scan while
     * reading the SQ element; lazy hits it when the SQ entry materializes.
     */
    function buildBadInItemCharsetFile() {
        const dicomDict = new DicomDict({});
        dicomDict.dict = {
            "00080050": { vr: "SH", Value: ["ACC1"] },
            "00081110": {
                vr: "SQ",
                Value: [
                    {
                        "00080005": { vr: "CS", Value: ["BOGUS!"] },
                        "00081150": { vr: "UI", Value: ["1.2.3"] }
                    }
                ]
            },
            "00100020": { vr: "LO", Value: ["P1"] }
        };
        return dicomDict.write();
    }

    test("ignoreErrors:false - eager throws at readFile, lazy throws the same error at first access (documented divergence)", () => {
        const buffer = buildBadInItemCharsetFile();

        expect(() => readEager(buffer)).toThrow(
            /Unsupported character set: bogus!/
        );

        // lazy returns the dict - the error surfaces at access, not before
        const lazy = readLazy(buffer);
        expect(Object.keys(lazy.dict).sort()).toEqual([
            "00080050",
            "00081110",
            "00100020"
        ]);
        expect(() => lazy.dict["00081110"].Value).toThrow(
            /Unsupported character set: bogus!/
        );
        expect(() => lazy.dict["00081110"]._rawValue).toThrow(
            /Unsupported character set: bogus!/
        );
        // entries the eager core never even reached remain readable
        expect(lazy.dict["00080050"].Value).toEqual(["ACC1"]);
        expect(lazy.dict["00100020"].Value).toEqual(["P1"]);
    });

    test("ignoreErrors:true - eager truncates the dict, lazy warns and never throws at access (documented divergence)", () => {
        const buffer = buildBadInItemCharsetFile();

        // eager: the nested item read throws, the outer read catches (and
        // warns) and returns everything BEFORE the failing SQ element
        const eager = readEager(buffer, { ignoreErrors: true });
        expect(Object.keys(eager.dict).sort()).toEqual(["00080050"]);

        const warnBase = log.warn.mock.calls.length;

        // lazy: full dict; the in-item charset resolves with eager's own
        // top-level warn-and-continue semantics - access never throws
        const lazy = readLazy(buffer, { ignoreErrors: true });
        expect(Object.keys(lazy.dict).sort()).toEqual([
            "00080050",
            "00081110",
            "00100020"
        ]);
        const items = lazy.dict["00081110"].Value;
        expect(items).toHaveLength(1);
        expect(String(items[0]["00080005"].Value[0])).toBe("ISO_IR 192");
        expect(items[0]["00081150"].Value).toEqual(["1.2.3"]);

        const charsetWarns = () =>
            warnCallsContaining("Unsupported character set", warnBase);
        expect(charsetWarns()).toBe(1);

        // materialization is cached: repeated access does not re-warn
        void lazy.dict["00081110"].Value;
        void lazy.dict["00081110"]._rawValue;
        expect(charsetWarns()).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// M1 - FileMetaInformationGroupLength VALUE drives the meta/dict partition
// ---------------------------------------------------------------------------
describe("M1: meta group length value windows the meta group", () => {
    /**
     * Shrinks the (0002,0000) value by the size of the LAST meta element,
     * so the eager core's value-windowed meta read ends one element early
     * and that element parses as the first BODY element instead.
     */
    function buildPatchedMetaLengthFile() {
        const buffer = readFixture("CT1_UNC.explicit_little_endian.dcm");
        const bytes = new Uint8Array(buffer);
        const dataSet = parseDicom(new Uint8Array(buffer.slice(0)));
        const groupLength = dataSet.elements.x00020000;
        expect(groupLength).toBeDefined();

        const metaElements = Object.values(dataSet.elements).filter(
            el => el.tagValue >>> 16 === 0x0002 && el.tag !== "x00020000"
        );
        const last = metaElements.reduce((a, b) =>
            b.startOffset > a.startOffset ? b : a
        );
        // the transfer syntax must stay inside the shrunken window
        expect(last.tag).not.toBe("x00020010");

        const view = new DataView(bytes.buffer);
        const original = view.getUint32(groupLength.dataOffset, true);
        view.setUint32(
            groupLength.dataOffset,
            original - (last.endOffset - last.startOffset),
            true
        );
        return {
            buffer: bytes.buffer,
            displacedTag: last.tag.slice(1).toUpperCase()
        };
    }

    test("both cores agree on which section every element lands in", () => {
        const { buffer, displacedTag } = buildPatchedMetaLengthFile();

        const eager = readEager(buffer);
        const lazy = readLazy(buffer);

        // the partition really moved: the last meta element is now a body
        // element in BOTH cores
        expect(eager.meta[displacedTag]).toBeUndefined();
        expect(eager.dict[displacedTag]).toBeDefined();
        expect(lazy.meta[displacedTag]).toBeUndefined();
        expect(lazy.dict[displacedTag]).toBeDefined();

        compareSection(eager.meta, lazy.meta, "meta");
        compareSection(eager.dict, lazy.dict, "dict");
    });

    test("the boundary mismatch routes the whole file through the eager fallback", () => {
        const { buffer } = buildPatchedMetaLengthFile();
        const lazy = readLazy(buffer);
        // fallback entries are plain data properties, not lazy getters
        const descriptor = Object.getOwnPropertyDescriptor(
            lazy.dict["00080060"],
            "Value"
        );
        expect(descriptor.get).toBeUndefined();
        expect(descriptor.value).toBeDefined();
    });

    test("a correct group length keeps the lazy path engaged", () => {
        const buffer = readFixture("CT1_UNC.explicit_little_endian.dcm");
        const lazy = readLazy(buffer);
        const descriptor = Object.getOwnPropertyDescriptor(
            lazy.dict["00080060"],
            "Value"
        );
        expect(typeof descriptor.get).toBe("function");
    });
});

// ---------------------------------------------------------------------------
// M2 - malformed encapsulated pixel data must not silently succeed
// ---------------------------------------------------------------------------
describe("M2: malformed encapsulated pixel data", () => {
    /**
     * Patches the second fragment's item tag to garbage (0008,0001) in a
     * no-BOT fragmented fixture with nothing after the pixel data element.
     * The garbage item's length field is widened to span the rest of the
     * file so the tokenizer's clamped-fragment recovery consumes the tail
     * cleanly and parsing SUCCEEDS with just a warning - the eager core
     * throws on the tag itself and never reads that length.
     */
    function buildMalformedEncapsulatedFile() {
        const buffer = readFixture(
            "encapsulated/multi-frame/CT0012.fragmented_no_bot_jpeg_lossless.70.dcm"
        );
        const bytes = new Uint8Array(buffer);
        const dataSet = parseDicom(new Uint8Array(buffer.slice(0)));
        const pixelEl = dataSet.elements.x7fe00010;
        expect(pixelEl.basicOffsetTable).toHaveLength(0);
        expect(pixelEl.fragments.length).toBeGreaterThan(1);
        // nothing after the pixel data element in this fixture
        expect(pixelEl.endOffset).toBe(bytes.length);

        const secondFragment = pixelEl.fragments[1];
        const view = new DataView(bytes.buffer);
        view.setUint16(secondFragment.position - 8, 0x0008, true);
        view.setUint16(secondFragment.position - 6, 0x0001, true);
        view.setUint32(
            secondFragment.position - 4,
            bytes.length - secondFragment.position,
            true
        );
        return bytes.buffer;
    }

    test("the tokenizer parses the malformed file with a warning (precondition)", () => {
        const buffer = buildMalformedEncapsulatedFile();
        const dataSet = parseDicom(new Uint8Array(buffer));
        expect(
            dataSet.warnings.some(
                warning =>
                    warning.includes("unexpected tag") &&
                    warning.includes(
                        "while searching for end of pixel data element"
                    )
            )
        ).toBe(true);
    });

    test("ignoreErrors:false - eager throws at readFile, lazy throws the eager-equivalent error at access (documented divergence)", () => {
        const buffer = buildMalformedEncapsulatedFile();

        expect(() => readEager(buffer)).toThrow(/Invalid tag in sequence/);

        const lazy = readLazy(buffer);
        expect(lazy.dict["7FE00010"]).toBeDefined();
        expect(() => lazy.dict["7FE00010"].Value).toThrow(
            /Invalid tag in sequence/
        );
        expect(() => lazy.dict["7FE00010"]._rawValue).toThrow(
            /Invalid tag in sequence/
        );
        // unaffected entries still materialize
        expect(lazy.dict["00080060"].Value).toBeDefined();
    });

    test("ignoreErrors:true - eager truncates, lazy yields undefined with one warning (documented divergence)", () => {
        const buffer = buildMalformedEncapsulatedFile();

        // eager catches (and warns) mid-scan: the pixel data element is lost
        const eager = readEager(buffer, { ignoreErrors: true });
        expect(eager.dict["7FE00010"]).toBeUndefined();
        expect(eager.dict["00080060"]).toBeDefined();

        const warnBase = log.warn.mock.calls.length;

        // lazy keeps the entry; access resolves to undefined + warning
        const lazy = readLazy(buffer, { ignoreErrors: true });
        expect(lazy.dict["7FE00010"]).toBeDefined();
        expect(lazy.dict["7FE00010"].Value).toBeUndefined();
        expect(lazy.dict["7FE00010"]._rawValue).toBeUndefined();

        const errorWarns = () =>
            warnCallsContaining("Invalid tag in sequence", warnBase);
        expect(errorWarns()).toBe(1);

        // cached: repeated access does not re-warn
        void lazy.dict["7FE00010"].Value;
        expect(errorWarns()).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// M3 - untilTag parity with the eager core
// ---------------------------------------------------------------------------
describe("M3: untilTag parity", () => {
    const ELE_FIXTURE = "CT1_UNC.explicit_little_endian.dcm";

    test("non-canonical (lowercase) untilTag is ignored, exactly like eager", () => {
        const buffer = readFixture(ELE_FIXTURE);
        const options = { untilTag: "7fe00010" };

        const eager = readEager(buffer, options);
        const lazy = readLazy(buffer, options);

        // eager compares against the UPPERCASE clean tag, so a lowercase
        // untilTag never matches and the whole file parses - in both cores
        expect(eager.dict["7FE00010"]).toBeDefined();
        expect(lazy.dict["7FE00010"]).toBeDefined();
        expect(lazy.dict["7FE00010"].Value).toBeDefined();
        compareSection(eager.meta, lazy.meta, "meta");
        compareSection(eager.dict, lazy.dict, "dict");
    });

    test("untilTag 00020010 with includeUntilTagValue:false: both cores refuse with a corrective error (parity kept through the #338 meta validation)", () => {
        // Updated in the issue-gap-fix arc: readFile's meta validation
        // (#338 family) now refuses to guess a transfer syntax when the
        // untilTag options exclude the (0002,0010) value — previously it
        // stored a stub { vr: undefined, Value: 0 } and silently
        // normalized to explicit little endian. The check sits above the
        // core dispatch, so eager and lazy converge on the same refusal.
        const buffer = readFixture(ELE_FIXTURE);
        const options = { untilTag: "00020010", includeUntilTagValue: false };

        expect(() => readEager(buffer, options)).toThrow(
            /meta header is missing TransferSyntaxUID/
        );
        expect(() => readLazy(buffer, options)).toThrow(
            /meta header is missing TransferSyntaxUID/
        );
    });

    test("untilTag 00020000 is ignored, exactly like eager (the group length element is consumed before the windowed meta read)", () => {
        const buffer = readFixture(ELE_FIXTURE);
        const options = { untilTag: "00020000", includeUntilTagValue: false };

        const eager = readEager(buffer, options);
        const lazy = readLazy(buffer, options);

        expect(lazy.meta["00020016"]).toBeDefined(); // meta NOT truncated
        expect(lazy.dict["7FE00010"]).toBeDefined();
        compareSection(eager.meta, lazy.meta, "meta");
        compareSection(eager.dict, lazy.dict, "dict");
    });

    test("untilTag strictly inside (00020000, 00020010) keeps the refusal (eager: corrective error since the #338 fix; formerly a bare TypeError)", () => {
        const buffer = readFixture(ELE_FIXTURE);
        const options = { untilTag: "00020001", includeUntilTagValue: true };

        expect(() => readEager(buffer, options)).toThrow(
            /meta header is missing TransferSyntaxUID/
        );
        expect(() => readLazy(buffer, options)).toThrow(
            /not supported by the lazy core/
        );
    });
});

// ---------------------------------------------------------------------------
// M4 - implicit-VR sequence-guess desync
// ---------------------------------------------------------------------------
describe("M4: implicit-VR dictionary framing (vrCallback)", () => {
    /**
     * Implicit-LE file with a defined-length element whose dictionary VR is
     * OB - (0028,2000) ICCProfile - and whose first 8 value bytes spell an
     * FFFE,E000 item tag plus a length that (when misread as a sequence)
     * swallows the following PixelData element. Without the dictionary
     * vrCallback the tokenizer's peek heuristic misframes it and the lazy
     * dict silently loses (7FE0,0010).
     */
    function buildItemMimicImplicitFile() {
        const bytes = [];
        const pushU8 = (...vals) => bytes.push(...vals);
        const pushU16 = v => pushU8(v & 0xff, (v >> 8) & 0xff);
        const pushU32 = v =>
            pushU8(
                v & 0xff,
                (v >> 8) & 0xff,
                (v >> 16) & 0xff,
                (v >>> 24) & 0xff
            );
        const pushTag = (group, element) => {
            pushU16(group);
            pushU16(element);
        };
        const pushAscii = s => {
            for (let i = 0; i < s.length; i++) {
                pushU8(s.charCodeAt(i));
            }
        };

        // preamble + DICM
        for (let i = 0; i < 128; i++) {
            pushU8(0);
        }
        pushAscii("DICM");

        // meta (explicit LE): (0002,0000) UL, (0002,0010) UI implicit-LE
        const transferSyntax = "1.2.840.10008.1.2\0";
        pushTag(0x0002, 0x0000);
        pushAscii("UL");
        pushU16(4);
        pushU32(8 + transferSyntax.length);
        pushTag(0x0002, 0x0010);
        pushAscii("UI");
        pushU16(transferSyntax.length);
        pushAscii(transferSyntax);

        // body (implicit LE)
        // (0008,0060) Modality CS
        pushTag(0x0008, 0x0060);
        pushU32(2);
        pushAscii("OT");
        // (0028,2000) ICCProfile, defined length 16; value mimics an item
        pushTag(0x0028, 0x2000);
        pushU32(16);
        pushTag(0xfffe, 0xe000); // value bytes 0-3: item tag mimic
        pushU32(16); // value bytes 4-7: "item length" overrunning the value
        pushTag(0x0008, 0x0000); // value bytes 8-11: plausible inner element
        pushU32(0); // value bytes 12-15: inner element length 0
        // (7FE0,0010) PixelData, 8 bytes - swallowed by the misframe
        pushTag(0x7fe0, 0x0010);
        pushU32(8);
        pushU8(1, 2, 3, 4, 5, 6, 7, 8);

        return new Uint8Array(bytes).buffer;
    }

    test("eager and lazy dicts are equal on the item-mimicking implicit file", () => {
        const buffer = buildItemMimicImplicitFile();

        const eager = readEager(buffer);
        const lazy = readLazy(buffer);

        expect(Object.keys(lazy.dict).sort()).toEqual([
            "00080060",
            "00282000",
            "7FE00010"
        ]);
        // the mimic element reads as plain OB bytes, not as a sequence
        expect(lazy.dict["00282000"].vr).toBe("OB");
        expect(
            new Uint8Array(lazy.dict["00282000"].Value[0]).slice(0, 4)
        ).toEqual(new Uint8Array([0xfe, 0xff, 0x00, 0xe0]));
        expect(new Uint8Array(lazy.dict["7FE00010"].Value[0])).toEqual(
            new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
        );
        compareSection(eager.meta, lazy.meta, "meta");
        compareSection(eager.dict, lazy.dict, "dict");
    });

    test("the lazy path (not the whole-file fallback) handles the implicit file", () => {
        const buffer = buildItemMimicImplicitFile();
        const lazy = readLazy(buffer);
        const descriptor = Object.getOwnPropertyDescriptor(
            lazy.dict["7FE00010"],
            "Value"
        );
        expect(typeof descriptor.get).toBe("function");
    });
});

// ---------------------------------------------------------------------------
// W2 - writer seam: _sourceSpan
// ---------------------------------------------------------------------------
describe("W2: _sourceSpan", () => {
    const ELE_FIXTURE = "CT1_UNC.explicit_little_endian.dcm";
    const SQ_FIXTURE =
        "encapsulated/multi-frame/CT0012.explicit_little_endian.dcm";
    const ENCAP_BOT_FIXTURE =
        "encapsulated/single-frame/CT1_UNC.fragmented_bot_jpeg_ls.80.dcm";

    /** Re-parses a span slice as a standalone explicit-LE element. */
    function reparseStandalone(spanBytes) {
        const stream = new ByteStream(littleEndianByteArrayParser, spanBytes);
        return readDicomElementExplicit(stream, []);
    }

    function sliceSpan(span) {
        expect(span).toBeDefined();
        expect(span.buffer).toBeInstanceOf(Uint8Array);
        return span.buffer.subarray(span.startOffset, span.endOffset);
    }

    test("plain element: span matches the parser element and re-parses standalone to the same value", () => {
        const buffer = readFixture(ELE_FIXTURE);
        const origEl = parseDicom(new Uint8Array(buffer.slice(0))).elements
            .x00080060;
        const lazy = readLazy(buffer);
        const entry = lazy.dict["00080060"];

        // non-enumerable: invisible to iteration/serialization
        expect(Object.keys(entry).sort()).toEqual(["Value", "_rawValue", "vr"]);

        const span = entry._sourceSpan;
        expect(span.startOffset).toBe(origEl.startOffset);
        expect(span.endOffset).toBe(origEl.endOffset);

        const slice = sliceSpan(span);
        const reEl = reparseStandalone(slice);
        expect(reEl.tag).toBe("x00080060");
        expect(reEl.vr).toBe("CS");
        expect(reEl.endOffset).toBe(slice.length); // span covers exactly the element
        const ds = new DataSet(littleEndianByteArrayParser, slice, {
            x00080060: reEl
        });
        expect(ds.string("x00080060")).toBe(entry.Value.join("\\"));
    });

    test("SQ element: span includes the delimiters and re-parses to the same items and values", () => {
        const buffer = readFixture(SQ_FIXTURE);
        const origEl = parseDicom(new Uint8Array(buffer.slice(0))).elements
            .x00089121;
        expect(origEl.hadUndefinedLength).toBe(true);

        const lazy = readLazy(buffer);
        const entry = lazy.dict["00089121"];
        const span = entry._sourceSpan;
        expect(span.startOffset).toBe(origEl.startOffset);
        expect(span.endOffset).toBe(origEl.endOffset);

        const slice = sliceSpan(span);
        const reEl = reparseStandalone(slice);
        expect(reEl.tag).toBe("x00089121");
        expect(reEl.vr).toBe("SQ");
        // undefined-length SQ: endOffset === slice end proves the item and
        // sequence delimiters are inside the span
        expect(reEl.endOffset).toBe(slice.length);
        expect(reEl.items).toHaveLength(origEl.items.length);

        // same values: the re-parsed standalone item resolves the same
        // strings the lazy entry materializes
        const lazyItems = entry.Value;
        expect(lazyItems).toHaveLength(reEl.items.length);
        const reItemDs = reEl.items[0].dataSet;
        expect(reItemDs.string("x0020000d")).toBe(
            lazyItems[0]["0020000D"].Value.join("\\")
        );
        // the nested defined-length SQ re-parses with its items too
        expect(reItemDs.elements.x00081115.items).toHaveLength(
            origEl.items[0].dataSet.elements.x00081115.items.length
        );
    });

    test("unencapsulated pixel data: span value bytes equal the materialized value", () => {
        const buffer = readFixture(SQ_FIXTURE);
        const lazy = readLazy(buffer);
        const entry = lazy.dict["7FE00010"];

        const slice = sliceSpan(entry._sourceSpan);
        const reEl = reparseStandalone(slice);
        expect(reEl.tag).toBe("x7fe00010");
        expect(reEl.endOffset).toBe(slice.length);

        const valueBytes = new Uint8Array(entry.Value[0]);
        const sliceBytes = slice.subarray(
            reEl.dataOffset,
            reEl.dataOffset + reEl.length
        );
        expect(valueBytes.length).toBe(sliceBytes.length);
        expect(
            Buffer.compare(Buffer.from(valueBytes), Buffer.from(sliceBytes))
        ).toBe(0);
    });

    test("encapsulated pixel data: span covers the whole run incl. BOT and sequence delimiter", () => {
        const buffer = readFixture(ENCAP_BOT_FIXTURE);
        const origEl = parseDicom(new Uint8Array(buffer.slice(0))).elements
            .x7fe00010;
        expect(origEl.encapsulatedPixelData).toBe(true);
        expect(origEl.basicOffsetTable.length).toBeGreaterThan(0);
        expect(origEl.fragments.length).toBeGreaterThan(1);

        const lazy = readLazy(buffer);
        const entry = lazy.dict["7FE00010"];
        const span = entry._sourceSpan;
        expect(span.startOffset).toBe(origEl.startOffset);
        expect(span.endOffset).toBe(origEl.endOffset);

        const slice = sliceSpan(span);
        const reEl = reparseStandalone(slice);
        expect(reEl.tag).toBe("x7fe00010");
        expect(reEl.encapsulatedPixelData).toBe(true);
        // BOT item, every fragment item and the sequence delimiter are all
        // inside the span
        expect(reEl.endOffset).toBe(slice.length);
        expect(reEl.basicOffsetTable).toEqual(origEl.basicOffsetTable);
        expect(reEl.fragments).toHaveLength(origEl.fragments.length);

        // same values: the single-BOT-entry frame assembled from the
        // standalone slice equals the lazily materialized frame
        const merged = new Uint8Array(
            reEl.fragments.reduce((size, f) => size + f.length, 0)
        );
        let position = 0;
        for (const f of reEl.fragments) {
            merged.set(
                slice.subarray(f.position, f.position + f.length),
                position
            );
            position += f.length;
        }
        const frame = new Uint8Array(entry.Value[0]);
        expect(frame.length).toBe(merged.length);
        expect(Buffer.compare(Buffer.from(frame), Buffer.from(merged))).toBe(0);
    });

    test("meta entries carry spans over the original input buffer", () => {
        const buffer = readFixture(ELE_FIXTURE);
        const lazy = readLazy(buffer);
        const entry = lazy.meta["00020010"];

        const slice = sliceSpan(entry._sourceSpan);
        const reEl = reparseStandalone(slice);
        expect(reEl.tag).toBe("x00020010");
        expect(reEl.endOffset).toBe(slice.length);
        const ds = new DataSet(littleEndianByteArrayParser, slice, {
            x00020010: reEl
        });
        expect(ds.string("x00020010")).toBe(entry.Value[0]);
    });

    test("the rewritten SpecificCharacterSet entry carries no span (its source bytes no longer represent it)", () => {
        const buffer = readFixture(ELE_FIXTURE); // stores ISO_IR 100
        const lazy = readLazy(buffer);
        const entry = lazy.dict["00080005"];
        expect(String(entry.Value[0])).toBe("ISO_IR 192"); // eager quirk, kept
        expect(entry._sourceSpan).toBeUndefined();
        expect(isCleanForPassthrough(entry)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// W2 - writer seam: _dirty soundness
// ---------------------------------------------------------------------------
describe("W2: _dirty soundness", () => {
    const ELE_FIXTURE = "CT1_UNC.explicit_little_endian.dcm";

    test("the _rawValue setter dirties the entry", () => {
        const lazy = readLazy(readFixture(ELE_FIXTURE));
        const entry = lazy.dict["00080060"];
        expect(entry._dirty).toBe(false);
        expect(isCleanForPassthrough(entry)).toBe(true);

        entry._rawValue = ["XX"];
        expect(entry._dirty).toBe(true);
        expect(entry._rawValue).toEqual(["XX"]);
        expect(isCleanForPassthrough(entry)).toBe(false);
    });

    test("the Value setter dirties the entry, including through the PN value-accessor proxy", () => {
        const lazy = readLazy(readFixture(ELE_FIXTURE));

        const entry = lazy.dict["00080060"];
        entry.Value = ["MR"];
        expect(entry._dirty).toBe(true);
        expect(isCleanForPassthrough(entry)).toBe(false);

        const pn = lazy.dict["00100010"]; // PN: wrapped by addTagAccessors
        expect(pn._dirty).toBe(false);
        pn.Value = [{ Alphabetic: "Doe^John" }];
        expect(pn._dirty).toBe(true);
        expect(isCleanForPassthrough(pn)).toBe(false);
    });

    test("absence of _dirty means dirty: eager, upsertTag and denaturalized entries never pass through", () => {
        const buffer = readFixture(ELE_FIXTURE);

        // eager-core entries carry no _dirty at all
        const eager = readEager(buffer);
        expect(eager.dict["00080060"]._dirty).toBeUndefined();
        expect(isCleanForPassthrough(eager.dict["00080060"])).toBe(false);

        // upsertTag on a NEW tag builds an eager-shaped entry (no _dirty)
        const lazy = readLazy(buffer);
        expect(lazy.dict["00104000"]).toBeUndefined(); // precondition
        lazy.upsertTag("00104000", "LT", ["comment"]);
        expect(lazy.dict["00104000"]._dirty).toBeUndefined();
        expect(isCleanForPassthrough(lazy.dict["00104000"])).toBe(false);

        // upsertTag on an EXISTING lazy entry assigns Value -> _dirty
        expect(lazy.dict["00080060"]._dirty).toBe(false);
        lazy.upsertTag("00080060", "CS", ["MR"]);
        expect(lazy.dict["00080060"]._dirty).toBe(true);
        expect(isCleanForPassthrough(lazy.dict["00080060"])).toBe(false);

        // denaturalized entries carry no _dirty either
        const natural = DicomMetaDictionary.naturalizeDataset(
            readEager(buffer).dict
        );
        const denaturalized = DicomMetaDictionary.denaturalizeDataset(natural);
        const someTag = Object.keys(denaturalized)[0];
        expect(denaturalized[someTag]._dirty).toBeUndefined();
        expect(isCleanForPassthrough(denaturalized[someTag])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// W2 - writer seam: isCleanForPassthrough over sequences
// ---------------------------------------------------------------------------
describe("W2: isCleanForPassthrough", () => {
    const SQ_FIXTURE =
        "encapsulated/multi-frame/CT0012.explicit_little_endian.dcm";
    const ENCAP_BOT_FIXTURE =
        "encapsulated/single-frame/CT1_UNC.fragmented_bot_jpeg_ls.80.dcm";

    test("untouched lazy entries are clean; materialization alone keeps them clean", () => {
        const lazy = readLazy(readFixture(SQ_FIXTURE));

        const plain = lazy.dict["00080060"];
        const sq = lazy.dict["00089121"];
        const pixel = lazy.dict["7FE00010"];
        expect(isCleanForPassthrough(plain)).toBe(true);
        expect(isCleanForPassthrough(sq)).toBe(true); // unmaterialized SQ
        expect(isCleanForPassthrough(pixel)).toBe(true);

        void plain.Value;
        void sq.Value; // materializes the items
        void pixel.Value;
        expect(isCleanForPassthrough(plain)).toBe(true);
        expect(isCleanForPassthrough(sq)).toBe(true);
        expect(isCleanForPassthrough(pixel)).toBe(true);

        // non-entries are never clean
        expect(isCleanForPassthrough(undefined)).toBe(false);
        expect(isCleanForPassthrough(null)).toBe(false);
    });

    test("assigning a nested item entry flips the enclosing SQ (the SQ's own _dirty stays false)", () => {
        const lazy = readLazy(readFixture(SQ_FIXTURE));
        const sq = lazy.dict["00089121"];
        const items = sq.Value;

        const itemDict = items[0];
        itemDict["0020000D"].Value = ["9.9.9"];

        expect(sq._dirty).toBe(false); // the SQ itself was never assigned
        expect(sq._nestedDirtCount).toBe(1);
        expect(isCleanForPassthrough(sq)).toBe(false);
        // siblings stay clean
        expect(isCleanForPassthrough(lazy.dict["00080060"])).toBe(true);
    });

    test("an assignment deep inside nested sequences flips every enclosing SQ", () => {
        const lazy = readLazy(readFixture(SQ_FIXTURE));
        const outer = lazy.dict["00089121"];
        const inner = outer.Value[0]["00081115"]; // SQ inside the item
        expect(inner.vr).toBe("SQ");
        expect(isCleanForPassthrough(outer)).toBe(true);
        expect(isCleanForPassthrough(inner)).toBe(true);

        inner.Value[0]["0020000E"].Value = ["9.9.9"]; // depth 2 assignment

        expect(isCleanForPassthrough(inner)).toBe(false);
        expect(isCleanForPassthrough(outer)).toBe(false);
        expect(inner._dirty).toBe(false);
        expect(outer._dirty).toBe(false);
        expect(inner._nestedDirtCount).toBe(1);
        expect(outer._nestedDirtCount).toBe(1);
    });

    test("assigning the nested SQ entry itself also flips the outer SQ", () => {
        const lazy = readLazy(readFixture(SQ_FIXTURE));
        const outer = lazy.dict["00089121"];
        const inner = outer.Value[0]["00081115"];

        inner.Value = [];

        expect(inner._dirty).toBe(true);
        expect(isCleanForPassthrough(inner)).toBe(false);
        expect(outer._dirty).toBe(false);
        expect(isCleanForPassthrough(outer)).toBe(false);
    });

    test("an in-item SpecificCharacterSet denies SQ passthrough even when untouched", () => {
        const dicomDict = new DicomDict({});
        dicomDict.dict = {
            "00081110": {
                vr: "SQ",
                Value: [
                    {
                        "00080005": { vr: "CS", Value: ["ISO_IR 192"] },
                        "00081150": { vr: "UI", Value: ["1.2.3"] }
                    }
                ]
            },
            "00100020": { vr: "LO", Value: ["P1"] }
        };
        const lazy = readLazy(dicomDict.write());

        const sq = lazy.dict["00081110"];
        // never materialized, _dirty false - but materializing would REWRITE
        // the in-item charset value to ["ISO_IR 192"], so the source bytes
        // are not what the eager writer would emit
        expect(sq._dirty).toBe(false);
        expect(isCleanForPassthrough(sq)).toBe(false);
        expect(isCleanForPassthrough(lazy.dict["00100020"])).toBe(true);
    });

    test("entries materialized through the eager-window fallback are denied (untracked nested entries)", () => {
        // Patch the BOT entry of a BOT fixture so it lands on no fragment
        // boundary: materializeEncapsulatedPixelData then delegates to the
        // eager window read, whose outputs the dirt tracking cannot see.
        const buffer = readFixture(ENCAP_BOT_FIXTURE);
        const bytes = new Uint8Array(buffer);
        const pixelEl = parseDicom(new Uint8Array(buffer.slice(0))).elements
            .x7fe00010;
        expect(pixelEl.basicOffsetTable.length).toBeGreaterThan(0);
        // BOT values live right after the first item header (8 bytes)
        new DataView(bytes.buffer).setUint32(pixelEl.dataOffset + 8, 2, true);

        const lazy = readLazy(bytes.buffer, { ignoreErrors: true });
        const entry = lazy.dict["7FE00010"];
        expect(isCleanForPassthrough(entry)).toBe(true); // not yet materialized

        void entry.Value; // routes through the eager-window fallback

        expect(entry._dirty).toBe(false);
        expect(entry._untrackedNested).toBe(true);
        expect(isCleanForPassthrough(entry)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// W2 - writer seam: _lazyWriteContext
// ---------------------------------------------------------------------------
describe("W2: _lazyWriteContext", () => {
    const ELE_FIXTURE = "CT1_UNC.explicit_little_endian.dcm";
    const ENCAP_BOT_FIXTURE =
        "encapsulated/single-frame/CT1_UNC.fragmented_bot_jpeg_ls.80.dcm";

    function buildFileWithCharset(charsets) {
        const dicomDict = new DicomDict({});
        dicomDict.dict = {
            "00080060": { vr: "CS", Value: ["OT"] },
            "00100020": { vr: "LO", Value: ["P1"] }
        };
        if (charsets) {
            dicomDict.dict["00080005"] = { vr: "CS", Value: charsets };
        }
        return dicomDict.write();
    }

    test("shape: non-enumerable, source byte array and the file's stored transfer syntax", () => {
        const buffer = readFixture(ELE_FIXTURE);
        const lazy = readLazy(buffer);

        expect(Object.keys(lazy).sort()).toEqual(["dict", "meta"]);
        const writeCtx = lazy._lazyWriteContext;
        expect(writeCtx).toBeDefined();
        expect(writeCtx.sourceByteArray).toBeInstanceOf(Uint8Array);
        expect(writeCtx.sourceByteArray.length).toBe(buffer.byteLength);
        expect(writeCtx.sourceSyntax).toBe("1.2.840.10008.1.2.1");
        // body spans index into the context's source byte array
        expect(lazy.dict["00080060"]._sourceSpan.buffer).toBe(
            writeCtx.sourceByteArray
        );
    });

    test("sourceSyntax keeps the file's own (encapsulated) transfer syntax UID", () => {
        const lazy = readLazy(readFixture(ENCAP_BOT_FIXTURE));
        expect(lazy._lazyWriteContext.sourceSyntax).toBe(
            lazy.meta["00020010"].Value[0]
        );
        expect(lazy._lazyWriteContext.sourceSyntax).toBe(
            "1.2.840.10008.1.2.4.80"
        );
    });

    test("charsetPassthroughSafe: true for absent / ISO_IR 6 / ISO_IR 192, false for latin and multi-valued charsets", () => {
        expect(
            readLazy(buildFileWithCharset(null))._lazyWriteContext
                .charsetPassthroughSafe
        ).toBe(true);
        expect(
            readLazy(buildFileWithCharset(["ISO_IR 192"]))._lazyWriteContext
                .charsetPassthroughSafe
        ).toBe(true);
        expect(
            readLazy(buildFileWithCharset(["ISO_IR 6"]))._lazyWriteContext
                .charsetPassthroughSafe
        ).toBe(true);
        expect(
            readLazy(buildFileWithCharset(["ISO_IR 100"]))._lazyWriteContext
                .charsetPassthroughSafe
        ).toBe(false);
        expect(
            readLazy(buildFileWithCharset(["\\ISO 2022 IR 87"]), {
                ignoreErrors: true
            })._lazyWriteContext.charsetPassthroughSafe
        ).toBe(false);
    });

    test("the real latin-1 fixture is flagged unsafe", () => {
        // CT1 stores SpecificCharacterSet "ISO_IR 100"
        const lazy = readLazy(readFixture(ELE_FIXTURE));
        expect(lazy._lazyWriteContext.charsetPassthroughSafe).toBe(false);
    });

    test("dicts from the whole-file eager fallback carry no _lazyWriteContext", () => {
        // shrink the meta group length VALUE by exactly one trailing meta
        // element so the tokenizer/eager meta boundaries disagree and the
        // lazy core delegates the whole file (same shape as the M1 tests)
        const buffer = readFixture(ELE_FIXTURE);
        const patched = new Uint8Array(buffer);
        const elements = parseDicom(new Uint8Array(buffer.slice(0))).elements;
        const groupLength = elements.x00020000;
        const last = Object.values(elements)
            .filter(
                el => el.tagValue >>> 16 === 0x0002 && el.tag !== "x00020000"
            )
            .reduce((a, b) => (b.startOffset > a.startOffset ? b : a));
        const view = new DataView(patched.buffer);
        view.setUint32(
            groupLength.dataOffset,
            view.getUint32(groupLength.dataOffset, true) -
                (last.endOffset - last.startOffset),
            true
        );

        const lazy = readLazy(patched.buffer);
        expect(lazy.dict["00080060"]).toBeDefined();
        // fallback entries are eager data properties, not lazy getters
        expect(
            Object.getOwnPropertyDescriptor(lazy.dict["00080060"], "Value").get
        ).toBeUndefined();
        expect(lazy._lazyWriteContext).toBeUndefined();
    });
});
