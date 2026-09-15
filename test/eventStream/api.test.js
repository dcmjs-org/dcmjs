import fs from "fs";
import path from "path";
import {
    DicomEventStream,
    Naturalized,
    DicomWebJson
} from "../../src/eventStream/api";

const REPO_ROOT = path.join(__dirname, "..", "..");
function readBuffer(rel) {
    const data = fs.readFileSync(path.join(REPO_ROOT, rel));
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

const jsonSource = {
    "00100020": { vr: "LO", Value: ["12345"] },
    "00080008": { vr: "CS", Value: ["ORIGINAL", "PRIMARY"] },
    "00081110": {
        vr: "SQ",
        Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
    }
};

describe("source/sink API (§32)", () => {
    test("DicomEventStream.fromDicomWebJson(...).toNaturalized()", async () => {
        const meta = await DicomEventStream.fromDicomWebJson(jsonSource).toNaturalized();
        expect(meta.PatientID).toBe("12345");
        expect(meta.ImageType).toEqual(["ORIGINAL", "PRIMARY"]);
        expect(meta.ReferencedStudySequence.ReferencedSOPClassUID).toBe("1.2.3");
    });

    test("Naturalized.from(events) and DicomWebJson.from(events) match the instance methods", async () => {
        const viaStatic = await Naturalized.from(
            DicomEventStream.fromDicomWebJson(jsonSource)
        );
        const viaMethod = await DicomEventStream.fromDicomWebJson(
            jsonSource
        ).toNaturalized();
        expect(viaStatic).toEqual(viaMethod);

        const json = await DicomWebJson.from(
            DicomEventStream.fromDicomWebJson(jsonSource)
        );
        expect(json).toEqual(jsonSource);
    });

    test("a source is reusable (process more than once)", async () => {
        const source = DicomEventStream.fromDicomWebJson(jsonSource);
        const a = await source.toNaturalized();
        const b = await source.toDicomWebJson();
        expect(a.PatientID).toBe("12345");
        expect(b).toEqual(jsonSource);
    });

    test("DicomEventStream.fromPart10(bytes).toNaturalized()", async () => {
        const buffer = readBuffer(
            "packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm"
        );
        const meta = await DicomEventStream.fromPart10(buffer).toNaturalized();
        expect(typeof meta.SOPInstanceUID).toBe("string");
        expect(meta.Rows).toBeGreaterThan(0);
    });

    test("asyncIterable() yields contract events", async () => {
        const types = [];
        for await (const ev of DicomEventStream.fromDicomWebJson(
            jsonSource
        ).asyncIterable()) {
            types.push(ev.type);
        }
        expect(types[0]).toBe("startDataSet");
        expect(types).toContain("startSequence");
        expect(types[types.length - 1]).toBe("endDataSet");
    });
});

describe("DicomEventStream.from — source auto-detection", () => {
    test("detects a Part 10 byte buffer", async () => {
        const fs = require("fs");
        const path = require("path");
        const full = path.join(
            __dirname,
            "..",
            "..",
            "packages/parser/testImages/CT1_UNC.explicit_little_endian.dcm"
        );
        const data = fs.readFileSync(full);
        const buffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength
        );
        const meta = await DicomEventStream.from(buffer).toNaturalized();
        expect(typeof meta.SOPInstanceUID).toBe("string");
    });

    test("detects a DICOMweb JSON object", async () => {
        const meta = await DicomEventStream.from({
            "00100020": { vr: "LO", Value: ["12345"] }
        }).toNaturalized();
        expect(meta.PatientID).toBe("12345");
    });

    test("detects a parsed dataset ({ meta, dict })", async () => {
        const meta = await DicomEventStream.from({
            meta: {},
            dict: { "00100020": { vr: "LO", Value: ["67890"] } }
        }).toNaturalized();
        expect(meta.PatientID).toBe("67890");
    });

    test("throws on an unrecognized source", () => {
        expect(() => DicomEventStream.from(42)).toThrow();
    });
});
