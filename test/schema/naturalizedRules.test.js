import { naturalizedRules } from "../../packages/schemas/src/schema/naturalizedRules.js";
import { parseVm } from "../../packages/schemas/generate/schemaRules.mjs";

describe("naturalizedRules catalog", () => {
    test("carries version and dictionary hash", () => {
        expect(naturalizedRules.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(naturalizedRules.dictionaryHash).toMatch(/^[0-9a-f]{16}$/);
    });

    test("covers the full standard dictionary minus structural exclusions", () => {
        // 5165 entries in the packed dictionary, minus 3 FFFE structural
        // items and 3 keywordless retired tags
        expect(Object.keys(naturalizedRules.attributes).length).toBe(5159);
        expect(naturalizedRules.attributes.FFFEE000).toBeUndefined();
        expect(naturalizedRules.attributes["00180061"]).toBeUndefined();
    });

    test("keywords are unique property names", () => {
        const seen = new Set();
        for (const entry of Object.values(naturalizedRules.attributes)) {
            expect(seen.has(entry.keyword)).toBe(false);
            seen.add(entry.keyword);
        }
    });

    test("spot-checks known attributes", () => {
        expect(naturalizedRules.attributes["00080008"]).toEqual({
            keyword: "ImageType",
            vr: "CS",
            vm: "2-n"
        });
        expect(naturalizedRules.attributes["00100020"]).toEqual({
            keyword: "PatientID",
            vr: "LO",
            vm: "1"
        });
        // multi-VR code resolved to an explicit union
        expect(naturalizedRules.attributes["00189810"]).toEqual({
            keyword: "ZeroVelocityPixelValue",
            vr: ["US", "SS"],
            vm: "1"
        });
    });

    test("every attribute has a parseable VM and known VR", () => {
        const knownScalar = new Set(
            (
                "AE AS AT CS DA DT LO LT SH ST TM UC UI UR UT " +
                "DS FL FD IS SL SS UL US " +
                "OB OD OF OL OV OW UN PN SQ UV SV"
            ).split(" ")
        );
        for (const [tag, entry] of Object.entries(
            naturalizedRules.attributes
        )) {
            expect(() => parseVm(entry.vm)).not.toThrow();
            const vrs = Array.isArray(entry.vr) ? entry.vr : [entry.vr];
            for (const vr of vrs) {
                if (!knownScalar.has(vr)) {
                    throw new Error(`${tag}: unknown VR ${vr}`);
                }
            }
        }
    });

    test("envelope freezes the decided contract tokens", () => {
        expect(naturalizedRules.envelope).toEqual({
            cardinality: "vm-based",
            personName: "componentObject",
            sequences: "datasetArray",
            privateTags: "creatorGrouped",
            unknownTags: "preserved",
            rawRetention: "inexactOnly",
            bulk: "referenceOrBinary"
        });
    });

    test("vrFormats table is present", () => {
        expect(naturalizedRules.vrFormats.DA).toEqual({
            pattern: "^\\d{8}$"
        });
        expect(naturalizedRules.vrFormats.DS).toEqual({ maxLength: 16 });
    });

    test("committed catalog is fresh and deterministic (CI determinism gate)", async () => {
        // Rebuilding from the live dictionary must reproduce the committed
        // artifact exactly — catches stale artifacts AND nondeterminism.
        const { buildCatalog } = await import(
            "../../packages/schemas/generate/buildCatalog.mjs"
        );
        expect(buildCatalog()).toEqual(naturalizedRules);
    });
});
