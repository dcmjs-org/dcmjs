/**
 * Standalone-load regression for @dcmjs-org/generator (pattern of the
 * dicomdir wave's standalone test): import ONLY core + parser + generator by
 * package name and exercise Part10Writer end to end — events → Part 10 bytes
 * → fromPart10Stream readback — WITHOUT @dcmjs-org/legacy anywhere in the
 * module graph.
 *
 * The virtual jest.mock below is the tripwire: if any module on this path
 * still imports @dcmjs-org/legacy (as Part10Writer did while the Part 10
 * envelope lived in legacy DicomDict.write), loading it throws and every
 * test here goes red. `virtual: true` keeps the mock registrable even once
 * the dependency edge is gone and the name no longer resolves from this
 * package.
 *
 * The deflated case matters most: the deflate branch of the envelope must
 * work legacy-free now that writePart10 lives in core/writeCore.js.
 */
jest.mock(
    "@dcmjs-org/legacy",
    () => {
        throw new Error(
            "standalone: @dcmjs-org/legacy must not be loaded on the core+parser+generator path"
        );
    },
    { virtual: true }
);

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

describe("Part10Writer standalone (no @dcmjs-org/legacy in the module graph)", () => {
    test("round-trips events to Part 10 bytes and back (explicit little endian)", async () => {
        const { buffer, back } = await roundTrip(EXPLICIT_LITTLE_ENDIAN);

        // Proper Part 10 envelope: 128-byte preamble then "DICM".
        const magic = new Uint8Array(buffer, 128, 4);
        expect(String.fromCharCode(...magic)).toBe("DICM");

        expectRoundTrippedValues(back, EXPLICIT_LITTLE_ENDIAN);
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
