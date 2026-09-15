/**
 * Issue-derived regression tests — UTF-8 write side: no double encoding.
 *
 * Upstream issues:
 * - https://github.com/dcmjs-org/dcmjs/issues/84 (category A — synthetic)
 *   Symptom: the old toUTF8Array-based writeString converted "°" into "Â°"
 *   on write — the UTF-8 bytes 0xC2 0xB0 were themselves re-encoded as
 *   UTF-8 (0xC3 0x82 0xC2 0xB0), so every non-ASCII character grew an "Â"
 *   (or similar) prefix each time the file was written.
 *
 * - https://github.com/dcmjs-org/dcmjs/issues/91 (category A — synthetic)
 *   Symptom: building a dataset from scratch (new DicomDict + upsertTag of
 *   an LO containing "ä"), writing, and re-reading returned "Ã¤" — the
 *   write/read pair did not round-trip non-ASCII strings, and there was no
 *   documented way to declare the character set for the write side.
 *
 * Status in 1.0: green. Strings are written once through TextEncoder
 * (writeUTF8String); with SpecificCharacterSet (0008,0005) = ISO_IR 192
 * declared in the dataset, the read side installs a UTF-8 decoder and the
 * values round-trip exactly.
 */

import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data;
const { DicomEventStream } = dcmjs.eventStream;

const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countBytes(haystack, needle) {
    let count = 0;
    outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) {
                continue outer;
            }
        }
        count++;
        i += needle.length - 1;
    }
    return count;
}

const DEGREE_UTF8 = [0xc2, 0xb0]; // "°"
const DEGREE_DOUBLE_ENCODED = [0xc3, 0x82, 0xc2, 0xb0]; // "Â°" as UTF-8
const A_UMLAUT_UTF8 = [0xc3, 0xa4]; // "ä"
const A_UMLAUT_DOUBLE_ENCODED = [0xc3, 0x83, 0xc2, 0xa4]; // "Ã¤" as UTF-8

describe("issue #84 — ° must hit the wire as 0xC2 0xB0 exactly once", () => {
    it("writes ° and ä as single-pass UTF-8 (no Â/Ã double encoding) and round-trips", async () => {
        // "ä°" appears in exactly one element of the file.
        const buffer = createSampleDicom({
            dict: {
                "00080005": { vr: "CS", Value: ["ISO_IR 192"] },
                "0008103E": { vr: "LO", Value: ["ä°"] } // SeriesDescription
            }
        });
        const bytes = new Uint8Array(buffer);

        expect(countBytes(bytes, DEGREE_UTF8)).toBe(1);
        expect(countBytes(bytes, DEGREE_DOUBLE_ENCODED)).toBe(0);
        expect(countBytes(bytes, A_UMLAUT_UTF8)).toBe(1);
        expect(countBytes(bytes, A_UMLAUT_DOUBLE_ENCODED)).toBe(0);

        // Eager read round-trips to the identical string.
        const reread = DicomMessage.readFile(buffer);
        expect(reread.dict["0008103E"].Value).toEqual(["ä°"]);

        // Streaming read agrees.
        const streamed = await DicomEventStream.fromPart10Stream(
            new Uint8Array(buffer)
        ).toNaturalized();
        expect(streamed.SeriesDescription).toBe("ä°");
    });

    it("PN with umlauts writes clean UTF-8 and survives a second write cycle without growing", () => {
        const buffer = createSampleDicom({
            dict: {
                "00080005": { vr: "CS", Value: ["ISO_IR 192"] },
                "00100010": { vr: "PN", Value: [{ Alphabetic: "Müller^Jörg" }] }
            }
        });
        const first = DicomMessage.readFile(buffer);
        const dataset = DicomMetaDictionary.naturalizeDataset(first.dict);
        expect(String(dataset.PatientName)).toBe("Müller^Jörg");

        // Write → read again: the classic #84 failure mode inserted one
        // more "Ã"/"Â" layer per write cycle.
        const second = DicomMessage.readFile(first.write());
        const dataset2 = DicomMetaDictionary.naturalizeDataset(second.dict);
        expect(String(dataset2.PatientName)).toBe("Müller^Jörg");
        const secondBytes = new Uint8Array(second.write());
        expect(countBytes(secondBytes, [0xc3, 0xbc])).toBe(1); // ü once
        expect(countBytes(secondBytes, [0xc3, 0x83])).toBe(0); // no Ã layer
    });
});

describe("issue #91 — upsertTag build-from-scratch round trip", () => {
    it("new DicomDict + upsertTag SpecificCharacterSet then LO 'ä' round-trips", () => {
        const dicomDict = new DicomDict({
            "00020010": { vr: "UI", Value: [EXPLICIT_LITTLE_ENDIAN] }
        });
        dicomDict.upsertTag("00080005", "CS", ["ISO_IR 192"]);
        dicomDict.upsertTag("0008103E", "LO", ["ä"]);

        const written = dicomDict.write();
        const bytes = new Uint8Array(written);
        expect(countBytes(bytes, A_UMLAUT_UTF8)).toBe(1);
        expect(countBytes(bytes, A_UMLAUT_DOUBLE_ENCODED)).toBe(0);

        const reread = DicomMessage.readFile(written);
        expect(reread.dict["0008103E"].Value).toEqual(["ä"]);
        // Not "Ã¤" — the exact mojibake reported upstream.
        expect(reread.dict["0008103E"].Value[0]).not.toBe("Ã¤");
    });
});
