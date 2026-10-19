import { readFileSync } from "fs";
import { join } from "path";
import {
    buildAttributeRules,
    BINARY_VRS
} from "../../packages/schemas/src/schema/naturalizedRules.js";
import dcmjs from "../../src/index.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

// The consumer walk: for every key of a real naturalized dataset, look up
// its rule and check the value against what the rule promises — list vs
// scalar, and the VR's JavaScript type. This is how a downstream package
// uses the rules against live data.
const STRING_VRS = new Set(
    "AE AS CS DA DT LO LT SH ST TM UC UI UR UT".split(" ")
);
const NUMBER_VRS = new Set("AT DS FL FD IS SL SS UL US".split(" "));

function checkScalar(vrs, value, path) {
    // multi-VR unions accept any member's type
    const ok = [...vrs].some(vr => {
        if (STRING_VRS.has(vr)) return typeof value === "string";
        if (NUMBER_VRS.has(vr)) return typeof value === "number";
        if (vr === "UV" || vr === "SV") return typeof value === "bigint";
        if (vr === "PN" || BINARY_VRS.has(vr) || vr === "SQ") {
            return typeof value === "object";
        }
        return false;
    });
    if (!ok) {
        throw new Error(`${path}: ${typeof value} does not fit ${[...vrs]}`);
    }
}

function walk(dataset, rulesByKeyword, path = "") {
    for (const [key, value] of Object.entries(dataset)) {
        if (key === "_vrMap") continue;
        const rule = rulesByKeyword.get(key);
        if (!rule) continue; // private or unknown tag: preserved, not ruled
        const where = `${path}/${key}`;
        if (value === null) continue; // any element can be present but empty
        const vrs = new Set(Array.isArray(rule.vr) ? rule.vr : [rule.vr]);
        if (vrs.has("SQ")) {
            const items = Array.isArray(value) ? value : [value];
            for (const item of items) {
                walk(item, rulesByKeyword, where);
            }
            continue;
        }
        if ([...vrs].some(vr => BINARY_VRS.has(vr))) {
            // frame list or one bulk reference object
            expect(typeof value).toBe("object");
            continue;
        }
        if (rule.multi) {
            expect(Array.isArray(value)).toBe(true);
            for (const entry of value) {
                if (entry !== null) checkScalar(vrs, entry, where);
            }
        } else {
            expect(Array.isArray(value)).toBe(false);
            checkScalar(vrs, value, where);
        }
    }
}

test.each(["sample-dicom.dcm", "sample-sr.dcm", "sample-op.dcm"])(
    "the rules describe every attribute of %s",
    fileName => {
        const rules = buildAttributeRules();
        const rulesByKeyword = new Map(
            Object.values(rules).map(r => [r.keyword, r])
        );
        const buffer = readFileSync(
            join(__dirname, "../../packages/fixtures/dicom", fileName)
        );
        const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
        );
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(arrayBuffer).dict
        );
        walk(dataset, rulesByKeyword);
    }
);
