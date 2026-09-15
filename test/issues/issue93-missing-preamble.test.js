/**
 * Issue #93 — "Is there a way to force-read a file if the DICM Tag in the
 * header is missing?"
 * https://github.com/dcmjs-org/dcmjs/issues/93
 *
 * Symptom: files whose 128-byte preamble + "DICM" marker were stripped by
 * an RT-planning export (a common DIMSE-adjacent shape: File Meta
 * Information starting at byte 0, or a bare dataset with no meta at all)
 * fail `DicomMessage.readFile` with "Error: Invalid a dicom file" and the
 * reporter found no way to force the read.
 *
 * Triage: A — synthetic reproducer (test/helper/sampleDicomPart10.js
 * stripPreamble / stripUntilDataset).
 *
 * 1.0 contract asserted here:
 *  - Eager readFile: none of the documented options (ignoreErrors,
 *    untilTag, includeUntilTagValue, noCopy, forceStoreRaw, core — see
 *    DicomMessage.readFile) bypasses the DICM check; the error must at
 *    least be corrective (it names the missing header). Pinned.
 *  - Streaming path (DicomEventStream.fromPart10Stream) explicitly
 *    supports PART10_NO_PREAMBLE (FMI starting at byte 0, group 0x0002
 *    first) — this is the supported answer to the issue. Pinned green.
 *  - A bare dataset (no meta group at all) is readable by no exported
 *    high-level API: eager throws the (misleading, since there IS no
 *    header to expect) "expected header is missing" error and the
 *    streaming path rejects with a valueless error. KNOWN GAP below.
 *    Closest workaround (pinned green): DicomMessage._read on a
 *    ReadBufferStream with an explicitly supplied transfer syntax —
 *    underscore-internal, but functional.
 *
 * Related existing coverage: test/eventStream/fromPart10Stream.test.js
 * (K2 test 9) pins error *parity* between eager and stream for
 * DICM-less/non-Part-10 bytes; it does not cover force-reading them.
 */

import dcmjs from "../../src/index.js";
import { DicomMessage } from "../../src/DicomMessage.js";
import { validationLog } from "../../src/log.js";
import {
    createSampleDicom,
    stripPreamble,
    stripUntilDataset,
    defaultImage
} from "../helper/sampleDicomPart10.js";
import { TagHex } from "../../src/constants/dicom.js";

validationLog.setLevel(5);

const { DicomEventStream, CollectorListener } = dcmjs.eventStream;
const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";

async function streamParse(buffer, options = {}) {
    const collector = new CollectorListener();
    await DicomEventStream.fromPart10Stream(
        new Uint8Array(buffer.slice(0)),
        options
    ).process(collector);
    return collector.result;
}

const BODY_TAGS = [
    TagHex.Rows,
    TagHex.Columns,
    TagHex.SamplesPerPixel,
    TagHex.BitsAllocated,
    TagHex.NumberOfFrames,
    TagHex.PixelRepresentation,
    TagHex.PixelData
];

describe("issue #93 — preamble/DICM missing", () => {
    describe("FMI present but preamble/DICM stripped (starts with group 0002)", () => {
        const buffer = stripPreamble(createSampleDicom());

        it("eager readFile throws a corrective error naming the missing header", () => {
            expect(() => DicomMessage.readFile(buffer.slice(0))).toThrow(
                /expected header|DICM/i
            );
        });

        it("eager readFile has no force option: ignoreErrors does not bypass the DICM check", () => {
            // Surveyed options in DicomMessage.readFile: ignoreErrors,
            // untilTag, includeUntilTagValue, noCopy, forceStoreRaw, core.
            // None accepts a preamble-less file on the eager path.
            expect(() =>
                DicomMessage.readFile(buffer.slice(0), { ignoreErrors: true })
            ).toThrow(/expected header|DICM/i);
        });

        it("readFile({ allowMissingHeader: true }) parses preamble-less FMI and full Part 10", () => {
            // Fixed in this arc: the eager opt-in accepts both shapes.
            const noPreamble = DicomMessage.readFile(buffer.slice(0), {
                allowMissingHeader: true
            });
            expect(noPreamble.meta[TagHex.TransferSyntaxUID].Value).toEqual([
                EXPLICIT_LITTLE_ENDIAN
            ]);
            expect(noPreamble.dict[TagHex.Rows].Value).toEqual([
                defaultImage.rows
            ]);

            const fullPart10 = DicomMessage.readFile(createSampleDicom(), {
                allowMissingHeader: true
            });
            expect(fullPart10.dict[TagHex.Rows].Value).toEqual([
                defaultImage.rows
            ]);
        });

        it("streaming path force-reads it: PART10_NO_PREAMBLE is supported", async () => {
            const result = await streamParse(buffer);
            expect(result.meta[TagHex.TransferSyntaxUID].Value).toEqual([
                EXPLICIT_LITTLE_ENDIAN
            ]);
            for (const tag of BODY_TAGS) {
                expect(result.dict[tag]).toBeDefined();
            }
            expect(result.dict[TagHex.Rows].Value).toEqual([defaultImage.rows]);
            // Path divergence documented: the eager reader rejects what the
            // streaming reader accepts. The streaming API is the supported
            // route for issue #93 files that retain their meta group.
        });
    });

    describe("bare dataset — no meta group at all (DIMSE-style)", () => {
        const buffer = stripUntilDataset(createSampleDicom());

        it("eager readFile throws its header error by default (force-read is opt-in)", () => {
            expect(() => DicomMessage.readFile(buffer.slice(0))).toThrow(
                /expected header|DICM/i
            );
        });

        // Fixed in this arc: readFile gained the explicit opt-in
        // `allowMissingHeader: true` (accepts full Part 10, preamble-less
        // with FMI, and bare datasets — Explicit LE assumed unless implicit
        // VR is detected), and the streaming raw-dataset fallback
        // force-reads a meta-less dataset under allowMissingHeader or
        // ignoreErrors by replaying the eager parse through fromDataSet.
        it("#93: a public API force-reads a meta-less dataset", async () => {
            // The contract: an explicit opt-in on the streaming
            // path (the go-forward surface) accepts a raw dataset.
            const result = await streamParse(buffer, {
                ignoreErrors: true
            });
            for (const tag of BODY_TAGS) {
                expect(result.dict[tag]).toBeDefined();
            }
        });

        it("readFile({ allowMissingHeader: true }) parses the bare dataset", () => {
            const { dict } = DicomMessage.readFile(buffer.slice(0), {
                allowMissingHeader: true
            });
            for (const tag of BODY_TAGS) {
                expect(dict[tag]).toBeDefined();
            }
            expect(dict[TagHex.Rows].Value).toEqual([defaultImage.rows]);
            expect(dict[TagHex.PixelData].Value[0].byteLength).toBe(
                defaultImage.totalPixelBytes
            );
        });

        it("workaround pinned: DicomMessage._read with an explicit syntax parses it", () => {
            const stream = new dcmjs.data.ReadBufferStream(buffer.slice(0));
            const dict = DicomMessage._read(stream, EXPLICIT_LITTLE_ENDIAN);
            for (const tag of BODY_TAGS) {
                expect(dict[tag]).toBeDefined();
            }
            expect(dict[TagHex.Rows].Value).toEqual([defaultImage.rows]);
            expect(dict[TagHex.PixelData].Value[0].byteLength).toBe(
                defaultImage.totalPixelBytes
            );
        });
    });
});
