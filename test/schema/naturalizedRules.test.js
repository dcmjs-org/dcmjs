import {
    naturalizedRules,
    getAttributeRule,
    buildAttributeRules,
    KNOWN_VRS
} from "../../packages/schemas/src/schema/naturalizedRules.js";
import { parseVm } from "../../packages/schemas/generate/schemaRules.mjs";
import { readFileSync } from "fs";
import { join } from "path";

describe("naturalizedRules", () => {
    test("carries the schema version and the envelope", () => {
        expect(naturalizedRules.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(naturalizedRules.envelope).toEqual({
            cardinality: "vm-based",
            values: "asReturned",
            personName: "componentObject",
            sequences: "datasetArrayOrItem",
            privateTags: "creatorGrouped",
            unknownTags: "preserved",
            rawRetention: "inexactOnly",
            bulk: "referenceOrBinary"
        });
    });

    test("covers the full standard dictionary minus structural exclusions", () => {
        // 5165 entries in the packed dictionary, minus 3 FFFE structural
        // items and 3 keywordless retired tags
        expect(Object.keys(naturalizedRules.attributes).length).toBe(5159);
        expect(naturalizedRules.attributes.FFFEE000).toBeUndefined();
        expect(naturalizedRules.attributes["00180061"]).toBeUndefined();
    });

    test("spot-checks derived rules", () => {
        expect(getAttributeRule("00080008")).toEqual({
            keyword: "ImageType",
            vr: "CS",
            vm: "2-n",
            multi: true
        });
        expect(getAttributeRule("00100020")).toEqual({
            keyword: "PatientID",
            vr: "LO",
            vm: "1",
            multi: false
        });
        // multi-VR code resolved to an explicit union
        expect(getAttributeRule("00189810")).toEqual({
            keyword: "ZeroVelocityPixelValue",
            vr: ["US", "SS"],
            vm: "1",
            multi: false
        });
    });

    test("every attribute has a parseable VM and a known VR", () => {
        for (const [tag, entry] of Object.entries(
            naturalizedRules.attributes
        )) {
            expect(() => parseVm(entry.vm)).not.toThrow();
            const vrs = Array.isArray(entry.vr) ? entry.vr : [entry.vr];
            for (const vr of vrs) {
                if (!KNOWN_VRS.has(vr)) {
                    throw new Error(`${tag}: unknown VR ${vr}`);
                }
            }
        }
    });

    test("keywords are unique property names", () => {
        const seen = new Set();
        for (const entry of Object.values(naturalizedRules.attributes)) {
            expect(seen.has(entry.keyword)).toBe(false);
            seen.add(entry.keyword);
        }
    });

    test("vrFormats documents Part 5 for string VRs only", () => {
        expect(naturalizedRules.vrFormats.DA).toEqual({
            pattern: "^\\d{8}$"
        });
        // DS and IS naturalize as numbers; a string format cannot apply
        expect(naturalizedRules.vrFormats.DS).toBeUndefined();
        expect(naturalizedRules.vrFormats.IS).toBeUndefined();
    });

    test("rule derivation is cached", () => {
        expect(buildAttributeRules()).toBe(buildAttributeRules());
    });

    test("committed projections are fresh (CI determinism gate)", async () => {
        // Regenerating from the live dictionary must reproduce the committed
        // artifacts exactly — catches stale artifacts AND nondeterminism.
        const { buildCatalog, typesSource, jsonSchemaSource } = await import(
            "../../packages/schemas/generate/buildCatalog.mjs"
        );
        const catalog = buildCatalog();
        const read = p =>
            readFileSync(join(__dirname, "../../packages/schemas", p), "utf8");
        expect(typesSource(catalog)).toBe(read("types/dcmjs-schema.d.ts"));
        expect(jsonSchemaSource(catalog)).toBe(
            read("schema/naturalized.schema.json")
        );
    });
});
