// The normative rule surface for the naturalized representation.
//
// The per-attribute rules are not a committed table: they derive on demand
// from the packed dictionary that dcmjs already ships, through the same
// isMultiVM rule the runtime uses, so the schema and the runtime cannot
// drift apart. Only the hand-decided data lives here: the envelope tokens,
// the Part 5 value formats (documentation, not validation), the multi-VR
// resolutions, and the exclusion lists. The generated JSON Schema and the
// .d.ts stay static files (ajv and tsc need static input); the generator
// in ../../generate derives them from this module.
import { getAllStandardTagEntries } from "../../../core/src/dicom.lookup.js";
import isMultiVM from "../../../core/src/utilities/isMultiVM.js";
import BINARY_VRS from "../../../core/src/utilities/binaryVRs.js";

export const SCHEMA_VERSION = "1.0.0";

export { BINARY_VRS };

// Every VR code an attribute rule may carry after MULTI_VR resolution.
export const KNOWN_VRS = new Set(
    (
        "AE AS AT CS DA DT LO LT SH ST TM UC UI UR UT " +
        "DS FL FD IS SL SS UL US UV SV " +
        "OB OD OF OL OV OW UN PN SQ"
    ).split(" ")
);

// Ambiguous dictionary VR codes -> explicit member unions (exhaustive for
// the packed dictionary; buildAttributeRules fails loudly on anything else).
export const MULTI_VR = {
    xs: ["US", "SS"],
    ox: ["OB", "OW"],
    up: ["UL"],
    lt: ["OW", "US", "SS"]
};

// Part 5 per-VR value-format constraints. Documentation only: the schema
// describes what dcmjs returns, and dcmjs passes values through as read, so
// these formats are NOT validation rules (envelope.values: "asReturned").
// DS and IS are absent because they naturalize as numbers, where a string
// format cannot apply.
export const vrFormats = {
    AE: { maxLength: 16 },
    AS: { pattern: "^\\d{3}[DWMY]$" },
    CS: { maxLength: 16, pattern: "^[A-Z0-9 _]*$" },
    DA: { pattern: "^\\d{8}$" },
    DT: {
        maxLength: 26,
        pattern:
            "^\\d{4}(\\d{2}(\\d{2}(\\d{2}(\\d{2}(\\d{2}(\\.\\d{1,6})?)?)?)?)?)?([+-]\\d{4})?$"
    },
    LO: { maxLength: 64 },
    LT: { maxLength: 10240 },
    SH: { maxLength: 16 },
    ST: { maxLength: 1024 },
    TM: { pattern: "^\\d{2}(\\d{2}(\\d{2}(\\.\\d{1,6})?)?)?$" },
    UI: { maxLength: 64, pattern: "^[0-9.]+$" }
};

// Group FFFE items are stream structure, not data elements (VR "na").
export const EXCLUDED_TAGS = new Set(["FFFEE000", "FFFEE00D", "FFFEE0DD"]);

// Retired tags the dictionary carries without a keyword (it gives all of
// them the placeholder "RETIRED_undefined", which cannot be a property
// name shared by unrelated tags). buildAttributeRules throws on any other
// tag whose keyword is missing or duplicated.
export const KEYWORDLESS_TAGS = new Set(["00180061", "04000315", "300A0782"]);

export const envelope = {
    cardinality: "vm-based", // VM 1/0-1 -> scalar, any other VM -> list
    values: "asReturned", // the schema describes what dcmjs returns; vrFormats documents Part 5 separately
    personName: "componentObject", // {Alphabetic,Ideographic,Phonetic}
    sequences: "datasetArrayOrItem", // SQ -> dataset[] | the single item
    privateTags: "creatorGrouped", // '<group>:<creator>' keys
    unknownTags: "preserved", // hex-tag key, VR in _vrMap
    rawRetention: "inexactOnly", // raw kept when round-trip inexact
    bulk: "referenceOrBinary" // {BulkDataURI} | {InlineBinary} | frame list
};

function bareTag(paren) {
    // "(0008,0008)" -> "00080008"
    const m = paren.match(/^\((\w{4}),(\w{4})\)$/);
    if (!m) {
        throw new Error(`unexpected tag format: ${paren}`);
    }
    return (m[1] + m[2]).toUpperCase();
}

let cachedRules = null;

/**
 * The per-attribute rule table, derived from the packed dictionary:
 * tag -> { keyword, vr, vm, multi }. vr is a string, or an array when the
 * dictionary VR code is a multi-VR union. multi follows the runtime
 * isMultiVM rule. Built once, cached.
 */
export function buildAttributeRules() {
    if (cachedRules) {
        return cachedRules;
    }
    const attributes = {};
    const tagByKeyword = new Map();
    for (const e of getAllStandardTagEntries()) {
        const tag = bareTag(e.tag);
        if (EXCLUDED_TAGS.has(tag) || KEYWORDLESS_TAGS.has(tag)) {
            continue;
        }
        if (!e.name || e.name === "RETIRED_undefined") {
            throw new Error(
                `${tag}: missing keyword — add the tag to KEYWORDLESS_TAGS or fix the dictionary`
            );
        }
        const holder = tagByKeyword.get(e.name);
        if (holder) {
            throw new Error(
                `${tag}: keyword "${e.name}" already used by ${holder} — keywords must be unique property names`
            );
        }
        tagByKeyword.set(e.name, tag);
        let vr;
        if (KNOWN_VRS.has(e.vr)) {
            vr = e.vr;
        } else if (MULTI_VR[e.vr]) {
            vr = MULTI_VR[e.vr];
        } else {
            throw new Error(`${tag} ${e.name}: unmapped VR code "${e.vr}"`);
        }
        attributes[tag] = {
            keyword: e.name,
            vr,
            vm: e.vm,
            multi: isMultiVM(e.vm)
        };
    }
    cachedRules = Object.fromEntries(
        Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b))
    );
    return cachedRules;
}

/** The rule for one bare tag ("00100020"), or undefined. */
export function getAttributeRule(tag) {
    return buildAttributeRules()[tag];
}

export const naturalizedRules = {
    version: SCHEMA_VERSION,
    envelope,
    vrFormats,
    get attributes() {
        return buildAttributeRules();
    }
};
