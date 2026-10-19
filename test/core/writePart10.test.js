import fs from "fs";
import path from "path";
import dcmjs from "../../src/index.js";
import { writePart10 } from "../../packages/core/src/index.js";

const { DicomMessage } = dcmjs.data;

/**
 * Byte-exactness pins for the Part 10 envelope relocation: legacy
 * DicomDict.write() is now a delegating call into core's writePart10
 * (core/writeCore.js), so for the same { meta, dict } input the two entry
 * points must produce byte-identical output — on the plain explicit little
 * endian path and on the deflate branch alike. Real fixtures drive the
 * comparison so the full element zoo (padding, sequences, group length
 * recomputation) is covered, not a synthetic minimum.
 */

const FIXTURE_ELE = path.join(
    __dirname,
    "..",
    "..",
    "packages",
    "fixtures",
    "testImages",
    "CT1_UNC.explicit_little_endian.dcm"
);

const FIXTURE_DEFLATED = path.join(
    __dirname,
    "..",
    "..",
    "packages",
    "fixtures",
    "testImages",
    "deflate",
    "image_dfl"
);

/** Exact ArrayBuffer of the file contents (no Node buffer-pool aliasing). */
function readFixture(fullPath) {
    const buffer = fs.readFileSync(fullPath);
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );
}

function expectSameBytes(a, b) {
    expect(a.byteLength).toBe(b.byteLength);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
}

describe("writePart10 — byte-exact with the delegating DicomDict.write()", () => {
    test("explicit little endian fixture", () => {
        const dicomDict = DicomMessage.readFile(readFixture(FIXTURE_ELE));

        const viaLegacy = dicomDict.write();
        const viaCore = writePart10(dicomDict);

        expectSameBytes(viaLegacy, viaCore);
    });

    test("deflated fixture (the relocated deflate branch)", () => {
        const dicomDict = DicomMessage.readFile(readFixture(FIXTURE_DEFLATED));

        const viaLegacy = dicomDict.write();
        const viaCore = writePart10(dicomDict);

        expectSameBytes(viaLegacy, viaCore);
    });

    test("missing TransferSyntaxUID defaults to explicit little endian, mutating meta (preserved semantics)", () => {
        const make = () => ({
            meta: {
                "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.7"] },
                "00020003": { vr: "UI", Value: ["1.2.3.4.5"] }
            },
            dict: {
                "00100020": { vr: "LO", Value: ["12345"] }
            }
        });

        const forCore = make();
        const bytes = writePart10(forCore);
        // The in-place default DicomDict.write always applied.
        expect(forCore.meta["00020010"].Value).toEqual(["1.2.840.10008.1.2.1"]);

        const dicomDict = new dcmjs.data.DicomDict(make().meta);
        dicomDict.dict = make().dict;
        expectSameBytes(dicomDict.write(), bytes);
    });
});
