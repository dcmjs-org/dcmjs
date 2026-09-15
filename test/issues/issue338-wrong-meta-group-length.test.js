/**
 * Issue #338 — "DicomMessage.readFile failes if GroupLength parameter is
 * wrong calculated"
 * https://github.com/dcmjs-org/dcmjs/issues/338
 *
 * Symptom: real clinical files whose (0002,0000)
 * FileMetaInformationGroupLength value does not match the actual meta
 * group size make readFile fail; `ignoreErrors: true` "succeeds" but
 * silently drops the affected tags. The reporter asked for an option to
 * ignore/recalculate the group length (DCMTK's dcmconv fixes such files
 * by recalculating it).
 *
 * Triage: A — synthetic reproducer: createSampleDicom() bytes with the
 * (0002,0000) UL value (fixed layout: preamble 128 + "DICM" 4 + tag 4 +
 * VR 2 + len 2 → value at byte offset 140) corrupted by +8 / -8 / 0.
 *
 * 1.0 contract asserted here: readFile either still parses the body
 * (tolerant resync at the first non-0002 element) or fails with a
 * corrective message naming the meta group length. Observed on the eager
 * path: internal stream errors ("Finding view is past end of input…"),
 * a bare TypeError for the 0 case, and under ignoreErrors a silent
 * garbage partial parse — all KNOWN GAPs below.
 *
 * The streaming path (fromPart10Stream) IS tolerant: for +8/-8 it ends
 * the FMI at the first non-0002 tag and parses the full body (pinned
 * green). For 0 it honors the bogus bound, so the remaining meta
 * elements are re-attributed to the dataset — body still parses fully
 * (pinned, with the placement quirk documented). This eager/stream
 * divergence is itself part of the gap.
 *
 * Related existing coverage: a MISSING meta group length is covered by
 * test/data.test.js:949,975 (no-meta-length-test.dcm) and the
 * fromPart10Stream K2 no-meta-length gate; this file covers a PRESENT
 * but WRONG value, which takes a different code path
 * (`stream.more(metaLength)` in DicomMessage.readFile).
 *
 * Helper quirk (documented, not asserted): sampleDicomPart10's default
 * meta writes a stray (0000,000F) element (an artifact of a missing
 * TagHex constant), which the eager reader files under meta and the
 * streaming reader files under dict. Assertions below therefore check
 * the seven body tags and the transfer syntax only.
 */

import dcmjs from "../../src/index.js";
import { DicomMessage } from "../../src/DicomMessage.js";
import { validationLog } from "../../src/log.js";
import {
    createSampleDicom,
    defaultImage
} from "../helper/sampleDicomPart10.js";
import { TagHex } from "../../src/constants/dicom.js";

validationLog.setLevel(5);

const { DicomEventStream, CollectorListener } = dcmjs.eventStream;

// (0002,0000) value location: 128 preamble + 4 "DICM" + 4 tag + 2 VR + 2 len
const GROUP_LENGTH_VALUE_OFFSET = 140;

const BODY_TAGS = [
    TagHex.Rows,
    TagHex.Columns,
    TagHex.SamplesPerPixel,
    TagHex.BitsAllocated,
    TagHex.NumberOfFrames,
    TagHex.PixelRepresentation,
    TagHex.PixelData
];

/** A fresh sample file with the meta group length corrupted. */
function corruptedSample(mutate) {
    const buffer = createSampleDicom();
    const view = new DataView(buffer);
    const original = view.getUint32(GROUP_LENGTH_VALUE_OFFSET, true);
    expect(original).toBeGreaterThan(0); // sanity: we found the UL value
    view.setUint32(GROUP_LENGTH_VALUE_OFFSET, mutate(original), true);
    return buffer;
}

/** 5 s timeout guard — a hang instead of an error is also a gap. */
function withTimeout(promise, ms = 5000) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error("parse timed out (possible hang)")),
            ms
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function streamParse(buffer) {
    const collector = new CollectorListener();
    await withTimeout(
        DicomEventStream.fromPart10Stream(new Uint8Array(buffer)).process(
            collector
        )
    );
    return collector.result;
}

function expectFullBody(dict) {
    for (const tag of BODY_TAGS) {
        expect(dict[tag]).toBeDefined();
    }
    expect(dict[TagHex.Rows].Value).toEqual([defaultImage.rows]);
    expect(dict[TagHex.PixelData].Value[0].byteLength).toBe(
        defaultImage.totalPixelBytes
    );
}

describe("issue #338 — wrong FileMetaInformationGroupLength", () => {
    describe("eager readFile", () => {
        // Fixed in this arc: readFile validates the declared (0002,0000)
        // value against a structural walk of the meta elements (first
        // non-0002 group tag wins) and uses the actual length, so the body
        // parses in full despite the corrupted declared value.
        it("#338: group length +8 — body parses (or error names the group length)", () => {
            const buffer = corruptedSample(v => v + 8);
            let dict;
            try {
                dict = DicomMessage.readFile(buffer).dict;
            } catch (e) {
                expect(e.message).toMatch(/group length|0002,0000|meta/i);
                return;
            }
            expectFullBody(dict);
        });

        // Fixed in this arc: same structural meta walk as above.
        it("#338: group length -8 — body parses (or error names the group length)", () => {
            const buffer = corruptedSample(v => v - 8);
            let dict;
            try {
                dict = DicomMessage.readFile(buffer).dict;
            } catch (e) {
                expect(e.message).toMatch(/group length|0002,0000|meta/i);
                return;
            }
            expectFullBody(dict);
        });

        // Fixed in this arc: the structural walk recovers the real meta
        // group from a declared length of 0, and a meta header that still
        // lacks TransferSyntaxUID now raises a corrective error naming the
        // meta group length instead of a bare TypeError.
        it("#338: group length 0 — body parses (or error names the group length)", () => {
            const buffer = corruptedSample(() => 0);
            let dict;
            try {
                dict = DicomMessage.readFile(buffer).dict;
            } catch (e) {
                expect(e.message).toMatch(/group length|0002,0000|meta/i);
                return;
            }
            expectFullBody(dict);
        });

        // Fixed in this arc: the structural meta walk applies to the
        // ignoreErrors path too, so the body tags are recovered instead of
        // a silent misaligned parse.
        it("#338: ignoreErrors does not return a silent garbage parse", () => {
            const buffer = corruptedSample(v => v + 8);
            const { dict } = DicomMessage.readFile(buffer, {
                ignoreErrors: true
            });
            expectFullBody(dict);
        });

        it("all three corruptions parse synchronously on the default path", () => {
            // Fixed in this arc: this previously pinned the broken shape
            // (all three corruptions threw internal errors). The structural
            // meta walk now recovers every case without throwing.
            expect(() =>
                DicomMessage.readFile(corruptedSample(v => v + 8))
            ).not.toThrow();
            expect(() =>
                DicomMessage.readFile(corruptedSample(v => v - 8))
            ).not.toThrow();
            expect(() =>
                DicomMessage.readFile(corruptedSample(() => 0))
            ).not.toThrow();
        });
    });

    describe("streaming path (fromPart10Stream) — tolerant resync", () => {
        it("group length +8: full body parses", async () => {
            const result = await streamParse(corruptedSample(v => v + 8));
            expectFullBody(result.dict);
        });

        it("group length -8: full body parses", async () => {
            const result = await streamParse(corruptedSample(v => v - 8));
            expectFullBody(result.dict);
        });

        it("group length 0: full body parses (meta elements re-attributed to dict)", async () => {
            const result = await streamParse(corruptedSample(() => 0));
            expectFullBody(result.dict);
            // Placement quirk under the bogus 0 bound: the real meta
            // elements ride along in dict — the transfer syntax is still
            // recoverable there. Documented, not a data loss.
            expect(result.dict[TagHex.TransferSyntaxUID].Value).toEqual([
                "1.2.840.10008.1.2.1"
            ]);
        });
    });
});
