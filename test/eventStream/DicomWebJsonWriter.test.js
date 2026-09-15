import fs from "fs";
import path from "path";
import dcmjs from "../../src/index.js";
import { DicomWebJsonWriter } from "../../src/eventStream/DicomWebJsonWriter";
import { fromDicomWebJson } from "../../src/eventStream/fromDicomWebJson";
import { fromPart10 } from "../../src/eventStream/fromPart10";
import { NaturalizedListener } from "../../src/eventStream/NaturalizedListener";

const { DicomMessage } = dcmjs.data;

describe("DicomWebJsonWriter — round-trips DICOMweb JSON", () => {
    test("JSON -> events -> JSON is identity (scalars, PN, sequence, bulk, inline)", async () => {
        const input = {
            "00080060": { vr: "CS", Value: ["CT"] },
            "00100010": { vr: "PN", Value: [{ Alphabetic: "Doe^Jane" }] },
            "00100020": { vr: "LO", Value: ["12345"] },
            "00200013": { vr: "IS", Value: [12] },
            "00081110": {
                vr: "SQ",
                Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
            },
            "00420011": { vr: "OB", BulkDataURI: "https://s/bulk/1" },
            "7FE00010": { vr: "OB", InlineBinary: "AQIDBA==" }
        };

        const writer = new DicomWebJsonWriter();
        await fromDicomWebJson(input, writer);

        expect(writer.result).toEqual(input);
    });

    test("an element with no values omits Value", async () => {
        const input = { "00100020": { vr: "LO" } };
        const writer = new DicomWebJsonWriter();
        await fromDicomWebJson(input, writer);
        expect(writer.result).toEqual({ "00100020": { vr: "LO" } });
    });
});

describe("DicomWebJsonWriter — end-to-end round-trip from Part 10", () => {
    const REPO_ROOT = path.join(__dirname, "..", "..");
    const fixtures = [
        "packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm",
        "packages/parser/testImages/CT1_UNC.implicit_little_endian.dcm",
        "test/sample-sr.dcm"
    ].map(rel => [rel, path.join(REPO_ROOT, rel)]);

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

    test.each(fixtures)("%s: bytes -> events -> JSON -> events -> naturalized is stable", async (_rel, full) => {
        try {
            DicomMessage.readFile(readBuffer(full));
        } catch {
            return;
        }

        // Direct: bytes -> naturalized
        const direct = new NaturalizedListener();
        await fromPart10(readBuffer(full), direct);

        // Via writer: bytes -> events -> DICOMweb JSON -> events -> naturalized
        const writer = new DicomWebJsonWriter();
        await fromPart10(readBuffer(full), writer);
        const viaJson = new NaturalizedListener();
        await fromDicomWebJson(writer.result, viaJson);

        expect(normalize(viaJson.result)).toEqual(normalize(direct.result));
    });
});
