import fs from "fs";
import path from "path";
import { parseDicom } from "@dcmjs/parser";
import dcmjs from "../src/index.js";
import { compareSection } from "./helper/equivalence.js";

const { DicomMessage } = dcmjs.data;

const FIXTURE_DIR = path.join(
    __dirname,
    "..",
    "packages",
    "parser",
    "testImages"
);

const FIXTURES = [
    "CT1_UNC.explicit_little_endian.dcm",
    "CT1_UNC.explicit_big_endian.dcm",
    "CT1_UNC.implicit_little_endian.dcm"
];

// {fragmented, not fragmented} x {BOT, no BOT}, single and multi frame,
// plus the native multi-frame implicit IM00001.
const ENCAPSULATED_FIXTURES = [
    "encapsulated/single-frame/CT1_UNC.fragmented_bot_jpeg_ls.80.dcm",
    "encapsulated/single-frame/CT1_UNC.fragmented_no_bot_jpeg_ls.80.dcm",
    "encapsulated/single-frame/CT1_UNC.not_fragmented_bot_jpeg_ls.80.dcm",
    "encapsulated/single-frame/CT1_UNC.not_fragmented_no_bot_jpeg_ls.80.dcm",
    "encapsulated/multi-frame/CT0012.not_fragmented_bot_jpeg_ls.80.dcm",
    "encapsulated/multi-frame/CT0012.not_fragmented_bot_rle.dcm",
    "encapsulated/multi-frame/CT0012.fragmented_no_bot_jpeg_lossless.70.dcm",
    "encapsulated/multi-frame/IM00001.fragmented_no_bot_jpeg_baseline.50.dcm",
    "encapsulated/multi-frame/IM00001.implicit_little_endian.dcm"
];

const DEFLATE_FIXTURES = [
    "deflate/image_dfl",
    "deflate/report_dfl",
    "deflate/wave_dfl"
];

// dcmjs' own fixtures with sequences (SR content sequences, per-frame
// functional groups, ...)
const SEQUENCE_FIXTURES = ["sample-sr.dcm", "sample-dicom.dcm"];

function toStandaloneArrayBuffer(data) {
    // standalone ArrayBuffer (node Buffers may be pooled views)
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

function readLocalFixture(name) {
    return toStandaloneArrayBuffer(fs.readFileSync(path.join(__dirname, name)));
}

function expectEquivalent(buffer, options = {}) {
    const eager = DicomMessage.readFile(buffer.slice(0), {
        ...options,
        core: "eager"
    });
    const lazy = DicomMessage.readFile(buffer.slice(0), {
        ...options,
        core: "lazy"
    });
    compareSection(eager.meta, lazy.meta, "meta");
    compareSection(eager.dict, lazy.dict, "dict");
    return { eager, lazy };
}

describe("lazy read core bridge", () => {
    describe.each(FIXTURES)("equivalence for %s", fixture => {
        test("meta and dict match the eager core when fully materialized", () => {
            const eager = DicomMessage.readFile(readFixture(fixture), {
                core: "eager"
            });
            const lazy = DicomMessage.readFile(readFixture(fixture), {
                core: "lazy"
            });

            compareSection(eager.meta, lazy.meta, "meta");
            compareSection(eager.dict, lazy.dict, "dict");
        });

        test("matches eager with forceStoreRaw", () => {
            const eager = DicomMessage.readFile(readFixture(fixture), {
                core: "eager",
                forceStoreRaw: true
            });
            const lazy = DicomMessage.readFile(readFixture(fixture), {
                core: "lazy",
                forceStoreRaw: true
            });

            compareSection(eager.meta, lazy.meta, "meta");
            compareSection(eager.dict, lazy.dict, "dict");
        });
    });

    describe("laziness", () => {
        const fixture = FIXTURES[0];

        test("no element materializes before access, first access materializes exactly one", () => {
            const materialized = [];
            const lazy = DicomMessage.readFile(readFixture(fixture), {
                core: "lazy",
                onMaterialize: tag => materialized.push(tag)
            });

            // wrapping resolved only the transfer syntax + charset entries
            // eagerly, and those are seeded without the callback
            expect(materialized).toEqual([]);

            const probeTag = Object.keys(lazy.dict).find(
                tag => tag !== "00080005"
            );
            const first = lazy.dict[probeTag].Value;
            expect(materialized).toEqual([probeTag]);

            // cached: repeat access does not rerun materialization
            const second = lazy.dict[probeTag].Value;
            expect(second).toBe(first);
            expect(materialized).toEqual([probeTag]);

            // _rawValue shares the same materialization
            void lazy.dict[probeTag]._rawValue;
            expect(materialized).toEqual([probeTag]);
        });

        test("Value setter replaces the cached value and marks the entry dirty", () => {
            const materialized = [];
            const lazy = DicomMessage.readFile(readFixture(fixture), {
                core: "lazy",
                onMaterialize: tag => materialized.push(tag)
            });

            const probeTag = Object.keys(lazy.dict).find(
                tag => tag !== "00080005"
            );
            const entry = lazy.dict[probeTag];
            expect(entry._dirty).toBe(false);

            entry.Value = ["REPLACED"];
            expect(entry.Value).toEqual(["REPLACED"]);
            expect(entry._dirty).toBe(true);
            // assignment must not force a byte-level materialization
            expect(materialized).toEqual([]);

            // _rawValue still materializes from the bytes on demand
            const raw = entry._rawValue;
            expect(materialized).toEqual([probeTag]);
            expect(raw).not.toBeUndefined();
            // and the assigned Value is preserved
            expect(entry.Value).toEqual(["REPLACED"]);

            // _dirty stays non-enumerable (same observable keys as eager)
            expect(Object.keys(entry)).toEqual(["vr", "Value", "_rawValue"]);
        });

        test("PN entries keep the addTagAccessors setter contract", () => {
            const lazy = DicomMessage.readFile(readFixture(fixture), {
                core: "lazy"
            });
            const pnTag = Object.keys(lazy.dict).find(
                tag => lazy.dict[tag].vr === "PN"
            );
            expect(pnTag).toBeDefined();

            const entry = lazy.dict[pnTag];
            entry.Value = "Doe^John";
            // proxy set-trap boxes the string and adds the dicom+json toJSON
            expect(entry.Value instanceof String).toBe(true);
            expect(JSON.parse(JSON.stringify(entry.Value))).toEqual([
                { Alphabetic: "Doe^John" }
            ]);
            expect(entry._dirty).toBe(true);
        });
    });

    describe("core selection", () => {
        const fixture = FIXTURES[0];

        test("default readFile uses the configured default core", () => {
            // the DCMJS_CORE env var intentionally overrides the default
            // (that is how a forced-core full-suite run works); without it
            // the default is the eager core — the lazy core is deprecated
            // (2026-08-02 stakeholder decision) and DCMJS_CORE=lazy is the
            // escape hatch until it is removed.
            const envCore =
                (typeof process !== "undefined" &&
                    process.env &&
                    process.env.DCMJS_CORE) ||
                "eager";
            expect(DicomMessage.defaultCore).toBe(envCore);

            const dict = DicomMessage.readFile(readFixture(fixture));
            const tag = Object.keys(dict.dict).find(t => t !== "00080005");
            const descriptor = Object.getOwnPropertyDescriptor(
                dict.dict[tag],
                "Value"
            );
            if (envCore === "lazy") {
                expect(typeof descriptor.get).toBe("function");
            } else {
                expect(descriptor.get).toBeUndefined();
                expect(descriptor.value).toBeDefined();
            }
        });

        test("options.core 'lazy' produces getter-backed entries", () => {
            const dict = DicomMessage.readFile(readFixture(fixture), {
                core: "lazy"
            });
            const tag = Object.keys(dict.dict).find(t => t !== "00080005");
            const descriptor = Object.getOwnPropertyDescriptor(
                dict.dict[tag],
                "Value"
            );
            expect(typeof descriptor.get).toBe("function");
        });

        test("DicomMessage.defaultCore routes readFile when no option given", () => {
            const original = DicomMessage.defaultCore;
            try {
                DicomMessage.defaultCore = "lazy";
                const dict = DicomMessage.readFile(readFixture(fixture));
                const tag = Object.keys(dict.dict).find(t => t !== "00080005");
                const descriptor = Object.getOwnPropertyDescriptor(
                    dict.dict[tag],
                    "Value"
                );
                expect(typeof descriptor.get).toBe("function");
            } finally {
                DicomMessage.defaultCore = original;
            }
        });

        test("unknown core throws", () => {
            expect(() =>
                DicomMessage.readFile(readFixture(fixture), {
                    core: "bogus"
                })
            ).toThrow(/Unknown DicomMessage.readFile core/);
        });
    });

    describe.each(ENCAPSULATED_FIXTURES)(
        "encapsulated equivalence for %s",
        fixture => {
            test("meta and dict match the eager core", () => {
                expectEquivalent(readFixture(fixture));
            });

            test("matches eager with forceStoreRaw", () => {
                expectEquivalent(readFixture(fixture), {
                    forceStoreRaw: true
                });
            });
        }
    );

    describe.each(DEFLATE_FIXTURES)("deflate equivalence for %s", fixture => {
        test("meta and dict match the eager core", () => {
            expectEquivalent(readFixture(fixture));
        });

        test("matches eager with forceStoreRaw", () => {
            expectEquivalent(readFixture(fixture), { forceStoreRaw: true });
        });
    });

    describe.each(SEQUENCE_FIXTURES)("sequence equivalence for %s", fixture => {
        test("meta and dict match the eager core", () => {
            expectEquivalent(readLocalFixture(fixture));
        });

        test("matches eager with forceStoreRaw", () => {
            expectEquivalent(readLocalFixture(fixture), {
                forceStoreRaw: true
            });
        });
    });

    describe("sequence laziness", () => {
        test("SQ items wrap structurally and nested entries stay lazy", () => {
            const buffer = readLocalFixture("sample-sr.dcm");
            const materialized = [];
            const lazy = DicomMessage.readFile(buffer, {
                core: "lazy",
                onMaterialize: tag => materialized.push(tag)
            });

            const sqTag = Object.keys(lazy.dict).find(
                tag => lazy.dict[tag].vr === "SQ"
            );
            expect(sqTag).toBeDefined();
            expect(materialized).toEqual([]);

            // materializing the SQ builds the item dicts but does not read
            // any nested element values
            const items = lazy.dict[sqTag].Value;
            expect(materialized).toEqual([sqTag]);
            expect(items.length).toBeGreaterThan(0);

            const itemDict = items[0];
            const nestedTag = Object.keys(itemDict)[0];
            const descriptor = Object.getOwnPropertyDescriptor(
                itemDict[nestedTag],
                "Value"
            );
            expect(typeof descriptor.get).toBe("function");

            // nested access materializes just that nested element
            void itemDict[nestedTag].Value;
            expect(materialized).toEqual([sqTag, nestedTag]);
        });
    });

    describe("untilTag", () => {
        const untilTag = "00080060"; // Modality, present in all CT1 fixtures

        describe.each(FIXTURES)("on %s", fixture => {
            test("matches eager with includeUntilTagValue: true", () => {
                expectEquivalent(readFixture(fixture), {
                    untilTag,
                    includeUntilTagValue: true
                });
            });

            test("matches eager with includeUntilTagValue: false", () => {
                expectEquivalent(readFixture(fixture), {
                    untilTag,
                    includeUntilTagValue: false
                });
            });
        });

        test("stops the dict at the untilTag element", () => {
            const lazy = DicomMessage.readFile(
                readFixture("CT1_UNC.explicit_little_endian.dcm"),
                { core: "lazy", untilTag, includeUntilTagValue: true }
            );
            const tags = Object.keys(lazy.dict).sort();
            expect(tags[tags.length - 1]).toBe(untilTag);
            expect(lazy.dict["7FE00010"]).toBeUndefined();
        });

        test("includeUntilTagValue: false produces eager's stub entry shape", () => {
            const lazy = DicomMessage.readFile(
                readFixture("CT1_UNC.explicit_little_endian.dcm"),
                { core: "lazy", untilTag, includeUntilTagValue: false }
            );
            const entry = lazy.dict[untilTag];
            expect(entry.vr).toBeUndefined();
            expect(entry.Value).toBe(0);
            expect(entry._rawValue).toBeUndefined();
            expect(Object.keys(entry)).toEqual(["vr", "Value", "_rawValue"]);
        });

        test("matches eager when the untilTag element is a sequence", () => {
            const buffer = readLocalFixture("sample-sr.dcm");
            const eagerFull = DicomMessage.readFile(buffer.slice(0), {
                core: "eager"
            });
            const sqTag = Object.keys(eagerFull.dict).find(
                tag => eagerFull.dict[tag].vr === "SQ"
            );
            expect(sqTag).toBeDefined();

            expectEquivalent(buffer, {
                untilTag: sqTag,
                includeUntilTagValue: true
            });
            expectEquivalent(buffer, {
                untilTag: sqTag,
                includeUntilTagValue: false
            });
        });

        test("matches eager when the untilTag element is encapsulated pixel data", () => {
            const buffer = readFixture(
                "encapsulated/multi-frame/CT0012.not_fragmented_bot_jpeg_ls.80.dcm"
            );
            expectEquivalent(buffer, {
                untilTag: "7FE00010",
                includeUntilTagValue: true
            });
            expectEquivalent(buffer, {
                untilTag: "7FE00010",
                includeUntilTagValue: false
            });
        });
    });

    describe("ignoreErrors partial parse", () => {
        function truncatedFixture(name) {
            const buffer = readFixture(name);
            // cut 2 bytes into the pixel data element's tag so both cores
            // fail while reading the same element header
            const dataSet = parseDicom(new Uint8Array(buffer.slice(0)));
            const pixelEl = dataSet.elements.x7fe00010;
            expect(pixelEl).toBeDefined();
            return buffer.slice(0, pixelEl.startOffset + 2);
        }

        test("returns the same partial dict in both cores", () => {
            const truncated = truncatedFixture(
                "CT1_UNC.explicit_little_endian.dcm"
            );
            const { lazy } = expectEquivalent(truncated, {
                ignoreErrors: true
            });
            // the element the truncation hit is absent, earlier ones present
            expect(lazy.dict["7FE00010"]).toBeUndefined();
            expect(lazy.dict["00080060"]).toBeDefined();
        });

        test("both cores throw without ignoreErrors", () => {
            const truncated = truncatedFixture(
                "CT1_UNC.explicit_little_endian.dcm"
            );
            expect(() =>
                DicomMessage.readFile(truncated.slice(0), { core: "eager" })
            ).toThrow();
            expect(() =>
                DicomMessage.readFile(truncated.slice(0), { core: "lazy" })
            ).toThrow();
        });
    });
});
