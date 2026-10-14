/**
 * Standalone-load regression for @dcmjs-org/generator (pattern of the
 * dicomdir wave's standalone test): import ONLY parser + generator by
 * package name and exercise Part10Writer end to end — events → Part 10 bytes
 * → fromPart10Stream readback.
 *
 * Neither the generator nor the parser may depend on @dcmjs-org/legacy
 * (Part10Writer did while the Part 10 envelope lived in legacy
 * DicomDict.write). The virtual jest.mock below is the tripwire: any load of
 * "@dcmjs-org/legacy" in this module graph fails the suite.
 *
 * The deflated case matters most: the deflate branch of the envelope must
 * work legacy-free now that writePart10 lives in core/writeCore.js.
 */
jest.mock(
    "@dcmjs-org/legacy",
    () => {
        throw new Error("@dcmjs-org/legacy must not load here");
    },
    { virtual: true }
);

import fs from "fs";
import path from "path";
import {
    fromDataSet,
    fromPart10Stream,
    CollectorListener
} from "@dcmjs-org/parser";
import { Part10Writer } from "@dcmjs-org/generator";

const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";
const DEFLATED_EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1.99";
const TRANSFER_SYNTAX_UID = "00020010";

function makeDataset(transferSyntaxUID) {
    return {
        meta: {
            [TRANSFER_SYNTAX_UID]: { vr: "UI", Value: [transferSyntaxUID] },
            "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
            "00020003": { vr: "UI", Value: ["1.2.3.4.5"] }
        },
        dict: {
            "00080008": { vr: "CS", Value: ["ORIGINAL", "PRIMARY"] },
            "00081110": {
                vr: "SQ",
                Value: [{ "00081150": { vr: "UI", Value: ["1.2.3"] } }]
            },
            "00100010": { vr: "PN", Value: [{ Alphabetic: "Doe^Jane" }] },
            "00100020": { vr: "LO", Value: ["12345"] }
        }
    };
}

/** events → Part10Writer → bytes → fromPart10Stream → collected dataset */
async function roundTrip(transferSyntaxUID) {
    const writer = new Part10Writer();
    await fromDataSet(makeDataset(transferSyntaxUID), writer);
    const buffer = writer.write();

    const collector = new CollectorListener();
    await fromPart10Stream(buffer, collector);
    return { buffer, back: collector.result };
}

function expectRoundTrippedValues(back, transferSyntaxUID) {
    expect(back.meta[TRANSFER_SYNTAX_UID].Value).toEqual([transferSyntaxUID]);
    expect(back.dict["00080008"].Value).toEqual(["ORIGINAL", "PRIMARY"]);
    expect(back.dict["00100010"].Value[0].Alphabetic).toBe("Doe^Jane");
    expect(back.dict["00100020"].Value).toEqual(["12345"]);
    expect(back.dict["00081110"].Value[0]["00081150"].Value).toEqual(["1.2.3"]);
}

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return entry.name.endsWith(".js") ? [full] : [];
    });
}

describe("Part10Writer standalone (generator and parser do not depend on @dcmjs-org/legacy)", () => {
    test.each(["generator", "parser"])(
        "the %s manifest and sources do not reference @dcmjs-org/legacy",
        name => {
            const packageDir = path.join(__dirname, "..", "..", name);
            const manifest = JSON.parse(
                fs.readFileSync(path.join(packageDir, "package.json"), "utf8")
            );
            expect(Object.keys(manifest.dependencies || {})).not.toContain(
                "@dcmjs-org/legacy"
            );
            for (const file of sourceFiles(path.join(packageDir, "src"))) {
                expect(fs.readFileSync(file, "utf8")).not.toMatch(
                    /["']@dcmjs-org\/legacy["']/
                );
            }
        }
    );

    test("round-trips events to Part 10 bytes and back (explicit little endian)", async () => {
        const { buffer, back } = await roundTrip(EXPLICIT_LITTLE_ENDIAN);

        // Proper Part 10 envelope: 128-byte preamble then "DICM".
        const magic = new Uint8Array(buffer, 128, 4);
        expect(String.fromCharCode(...magic)).toBe("DICM");

        expectRoundTrippedValues(back, EXPLICIT_LITTLE_ENDIAN);
    });

    test("reads a bare dataset (no preamble, no File Meta) with allowMissingHeader", async () => {
        const { buffer } = await roundTrip(EXPLICIT_LITTLE_ENDIAN);
        // (0002,0000) value at 140 gives the File Meta length after byte 144.
        const metaEnd = 144 + new DataView(buffer).getUint32(140, true);
        const collector = new CollectorListener();
        await fromPart10Stream(buffer.slice(metaEnd), collector, {
            allowMissingHeader: true
        });
        const { dict } = collector.result;
        expect(dict["00080008"].Value).toEqual(["ORIGINAL", "PRIMARY"]);
        expect(dict["00081110"].Value[0]["00081150"].Value).toEqual(["1.2.3"]);
    });

    test("round-trips a DEFLATED transfer syntax (the relocated deflate branch, legacy-free)", async () => {
        const { buffer, back } = await roundTrip(
            DEFLATED_EXPLICIT_LITTLE_ENDIAN
        );
        const { buffer: eleBuffer } = await roundTrip(EXPLICIT_LITTLE_ENDIAN);

        // The deflated body genuinely went through the deflate branch: the
        // same dataset written as plain ELE has a different byte length
        // (identical length would mean the body was written uncompressed).
        expect(buffer.byteLength).not.toBe(eleBuffer.byteLength);

        expectRoundTrippedValues(back, DEFLATED_EXPLICIT_LITTLE_ENDIAN);
    });
});
