/**
 * Issue-derived regression tests — charset applied to sequence-nested strings.
 *
 * Upstream issues:
 * - https://github.com/dcmjs-org/dcmjs/issues/503 (category A — synthetic)
 *   Symptom: string-VR content (LO, SH, PN, ST, ...) nested inside a
 *   Sequence (SQ) item is decoded with a hard-coded latin1 TextDecoder
 *   instead of the decoder derived from the dataset's SpecificCharacterSet
 *   (0008,0005), even when that attribute declares ISO_IR 192 (UTF-8) and
 *   appears before the sequence. Top-level strings in the same file decode
 *   correctly, so "café °" nested in a sequence comes back as "cafÃ© Â°".
 *   Read-side only — the written bytes are correct UTF-8.
 *
 * - https://github.com/dcmjs-org/dcmjs/issues/451 (category A — synthetic)
 *   Symptom: DicomMessage._read() installs the decoder only when it happens
 *   to encounter (0008,0005) in the top-level element loop; the charset
 *   must apply to every string parsed after that element regardless of
 *   where the string sits (top level or nested in SQ item substreams).
 *
 * Findings pinned here: all three read paths (eager DicomMessage.readFile,
 * fromPart10, fromPart10Stream) thread the dataset decoder into sequence
 * items. The eager path historically left SQ-nested strings on the default
 * latin1 decoder; fixed in this arc by propagating the active decoder into
 * the sequence-item substreams built by stream.more().
 */

import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;
const { DicomEventStream } = dcmjs.eventStream;

const TOP_LO = "café °";
const TOP_PN = "Müller^Jörg";
const NESTED_LO = "café °";
const NESTED_ST = "café °";
const NESTED_PN = "Müller^Jörg";

/**
 * Explicit-LE Part 10 with SpecificCharacterSet ISO_IR 192, top-level
 * LO/PN carrying multi-byte UTF-8, and a ProcedureCodeSequence (0008,1032)
 * item carrying the same UTF-8 bytes in LO / ST / PN elements.
 * (0008,0005) sorts before every other string element, so the decoder is
 * installed before any of them is parsed.
 */
function buildUtf8SqPart10() {
    return createSampleDicom({
        dict: {
            "00080005": { vr: "CS", Value: ["ISO_IR 192"] },
            "00081030": { vr: "LO", Value: [TOP_LO] }, // StudyDescription
            "00100010": { vr: "PN", Value: [{ Alphabetic: TOP_PN }] },
            "00081032": {
                // ProcedureCodeSequence, one item
                vr: "SQ",
                Value: [
                    {
                        "00080081": { vr: "ST", Value: [NESTED_ST] }, // InstitutionAddress
                        "00080104": { vr: "LO", Value: [NESTED_LO] }, // CodeMeaning
                        "00081050": {
                            vr: "PN",
                            Value: [{ Alphabetic: NESTED_PN }]
                        }
                    }
                ]
            }
        }
    });
}

describe("issue #503 — SQ-nested strings must use the dataset charset", () => {
    it("eager readFile decodes top-level LO and PN as UTF-8", () => {
        const dicomDict = DicomMessage.readFile(buildUtf8SqPart10());
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        expect(dataset.StudyDescription).toBe(TOP_LO);
        expect(String(dataset.PatientName)).toBe(TOP_PN);
    });

    // Fixed in this arc: BufferStream.more() now propagates the parent
    // stream's active decoder into the sequence-item substream, so
    // SQ-nested strings decode with the dataset's SpecificCharacterSet.
    it("#503: eager readFile decodes SQ-nested strings with the dataset SpecificCharacterSet", () => {
        const dicomDict = DicomMessage.readFile(buildUtf8SqPart10());
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        const item = dataset.ProcedureCodeSequence[0];
        // Nested strings must be identical to the top-level ones …
        expect(item.CodeMeaning).toBe(dataset.StudyDescription);
        expect(String(item.PerformingPhysicianName)).toBe(
            String(dataset.PatientName)
        );
        // … and correctly decoded (no "Ã©"/"Â°" mojibake).
        expect(item.CodeMeaning).toBe(NESTED_LO);
        expect(item.InstitutionAddress).toBe(NESTED_ST);
        expect(String(item.PerformingPhysicianName)).toBe(NESTED_PN);
    });

    it("event stream (fromPart10) decodes SQ-nested strings with the dataset charset", async () => {
        const dataset = await DicomEventStream.fromPart10(
            buildUtf8SqPart10()
        ).toNaturalized();
        expect(dataset.StudyDescription).toBe(TOP_LO);
        expect(String(dataset.PatientName)).toBe(TOP_PN);
        const item = dataset.ProcedureCodeSequence[0];
        expect(item.CodeMeaning).toBe(NESTED_LO);
        expect(item.InstitutionAddress).toBe(NESTED_ST);
        expect(String(item.PerformingPhysicianName)).toBe(NESTED_PN);
        // Nested equals top-level — #451's invariant.
        expect(item.CodeMeaning).toBe(dataset.StudyDescription);
    });

    it("streaming path (fromPart10Stream) decodes SQ-nested strings with the dataset charset", async () => {
        const dataset = await DicomEventStream.fromPart10Stream(
            new Uint8Array(buildUtf8SqPart10())
        ).toNaturalized();
        expect(dataset.StudyDescription).toBe(TOP_LO);
        const item = dataset.ProcedureCodeSequence[0];
        expect(item.CodeMeaning).toBe(NESTED_LO);
        expect(item.InstitutionAddress).toBe(NESTED_ST);
        expect(String(item.PerformingPhysicianName)).toBe(NESTED_PN);
    });
});

describe("issue #451 — decoder applies to everything parsed after (0008,0005)", () => {
    // (0008,0005) is the lowest string tag in the synthetic file, so the
    // decoder is installed before any other string element is read; every
    // later top-level string must come back UTF-8-decoded in both paths.
    it("top-level strings parsed after the charset element decode identically in eager and stream paths", async () => {
        const buffer = buildUtf8SqPart10();
        const eager = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(buffer).dict
        );
        const streamed = await DicomEventStream.fromPart10Stream(
            new Uint8Array(buffer)
        ).toNaturalized();
        expect(eager.StudyDescription).toBe(TOP_LO);
        expect(streamed.StudyDescription).toBe(TOP_LO);
        expect(String(eager.PatientName)).toBe(String(streamed.PatientName));
        // SQ-nested strings now agree across paths too — see the #503
        // tests above.
    });
});
