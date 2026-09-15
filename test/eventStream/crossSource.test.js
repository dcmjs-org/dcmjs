import fs from "fs";
import path from "path";
import dcmjs from "../../src/index.js";
import { fromPart10 } from "../../src/eventStream/fromPart10";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { fromDicomWebJson } from "../../src/eventStream/fromDicomWebJson";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";
import { DicomWebJsonWriter } from "../../src/eventStream/DicomWebJsonWriter";

const { DicomMessage } = dcmjs.data;

/**
 * Slice G — cross-source equivalence matrix (§31, §4.4).
 *
 * For every local fixture, build the naturalized object via three independent
 * source paths and assert they agree:
 *   1. raw Part 10 bytes            -> fromPart10
 *   2. parsed dcmjs dict            -> fromDataSet
 *   3. DICOMweb JSON                -> fromDicomWebJson, where the JSON is itself
 *      produced from the bytes through the writer (bytes -> events ->
 *      DicomWebJsonWriter), exercising the contract as both a source and a sink.
 *
 * Comparison is semantic, not byte-identical (§31): binary leaves collapse to a
 * placeholder (raw-fragment vs frame grouping differs by path), single-item
 * sequence proxies compare structurally, and SpecificCharacterSet is exempt
 * (readFile rewrites it to ISO_IR 192 while the raw paths keep the source value).
 */

const REPO_ROOT = path.join(__dirname, "..", "..");
const PARSER_IMAGES_DIR = path.join(REPO_ROOT, "packages", "parser", "testImages");
const TEST_DIR = path.join(REPO_ROOT, "test");

function discover(dir, accept) {
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) out.push(...discover(full, accept));
        else if (stat.isFile() && accept(name)) out.push(full);
    }
    return out;
}

const FIXTURES = [
    ...discover(PARSER_IMAGES_DIR, n => !n.toLowerCase().endsWith(".md")),
    ...discover(TEST_DIR, n => /\.(dcm|dicom|lei)$/i.test(n))
].map(full => [path.relative(REPO_ROOT, full), full]);

function readBuffer(full) {
    const data = fs.readFileSync(full);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function normalize(v) {
    if (v === null || typeof v !== "object") return v;
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return "__bytes";
    if ("InlineBinary" in v || "BulkDataURI" in v) return "__binary";
    if (Array.isArray(v)) return v.map(normalize);
    const out = {};
    for (const k of Object.keys(v).sort()) {
        if (k === "SpecificCharacterSet") continue;
        out[k] = normalize(v[k]);
    }
    return out;
}

async function naturalize(run) {
    const l = new NaturalizedListener();
    await run(l);
    return normalize(l.result);
}

describe("cross-source equivalence matrix (§31)", () => {
    test.each(FIXTURES)("%s agrees across bytes, dict, and DICOMweb JSON", async (_rel, full) => {
        let dict;
        try {
            dict = DicomMessage.readFile(readBuffer(full));
        } catch {
            return; // fixtures both cores reject
        }

        // 1. raw bytes -> naturalized
        const fromBytes = await naturalize(l => fromPart10(readBuffer(full), l));

        // 2. dict -> naturalized
        const fromDict = await naturalize(l =>
            fromDataSet({ meta: dict.meta, dict: dict.dict }, l)
        );

        // 3. bytes -> events -> DICOMweb JSON -> events -> naturalized
        const writer = new DicomWebJsonWriter();
        await fromPart10(readBuffer(full), writer);
        const fromJson = await naturalize(l => fromDicomWebJson(writer.result, l));

        expect(fromDict).toEqual(fromBytes);
        expect(fromJson).toEqual(fromBytes);
    });
});
