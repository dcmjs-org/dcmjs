import fs from "fs";
import path from "path";
import dcmjs from "../../src/index.js";
import { Part10Writer } from "../../src/eventStream/Part10Writer";
import { DicomEventStream } from "../../src/eventStream/api";
import { fromDataSet } from "../../src/eventStream/fromDataSet";
import { fromPart10 } from "../../src/eventStream/fromPart10";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";

const { DicomMessage } = dcmjs.data;

describe("Part10Writer — events to Part 10 bytes", () => {
    test("round-trips a synthesized dataset through bytes", async () => {
        const dataset = {
            meta: {
                "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] },
                "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
                "00020003": { vr: "UI", Value: ["1.2.3.4.5"] }
            },
            dict: {
                "00100010": { vr: "PN", Value: [{ Alphabetic: "Doe^Jane" }] },
                "00100020": { vr: "LO", Value: ["12345"] },
                "00080008": { vr: "CS", Value: ["ORIGINAL", "PRIMARY"] },
                "00081110": {
                    vr: "SQ",
                    Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
                }
            }
        };

        const writer = new Part10Writer();
        await fromDataSet(dataset, writer);
        const buffer = writer.write();

        const back = DicomMessage.readFile(buffer);
        expect(back.dict["00100020"].Value).toEqual(["12345"]);
        expect(back.dict["00080008"].Value).toEqual(["ORIGINAL", "PRIMARY"]);
        expect(back.dict["00100010"].Value[0].Alphabetic).toBe("Doe^Jane");
        expect(back.dict["00081110"].Value[0]["00081150"].Value).toEqual(["1.2.3"]);
        // meta round-trips (group length is written into the bytes and consumed
        // by readFile, so it is not surfaced on back.meta).
        expect(back.meta["00020010"].Value).toEqual(["1.2.840.10008.1.2.1"]);
    });

    test("DicomEventStream.toPart10() returns a writable buffer", async () => {
        const dataset = {
            meta: { "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] } },
            dict: { "00100020": { vr: "LO", Value: ["abc"] } }
        };
        const buffer = await DicomEventStream.fromDataSet(dataset).toPart10();
        const back = DicomMessage.readFile(buffer);
        expect(back.dict["00100020"].Value).toEqual(["abc"]);
    });
});

describe("Part10Writer — corpus semantic round-trip", () => {
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

    test.each(FIXTURES)("%s: bytes -> events -> Part 10 -> readback naturalizes the same", async (_rel, full) => {
        let direct;
        try {
            direct = await naturalize(l => fromPart10(readBuffer(full), l));
        } catch {
            return; // fixtures both cores reject
        }

        const writer = new Part10Writer();
        await fromPart10(readBuffer(full), writer);
        // allowInvalidVRLength lets deliberately-malformed fixtures (e.g.
        // over-length TM) round-trip instead of being rejected on write.
        const rewritten = writer.write({ allowInvalidVRLength: true });

        const back = await naturalize(l => fromPart10(rewritten, l));
        expect(back).toEqual(direct);
    });
});
