/**
 * Issue-derived regression tests — NUL-padded string values.
 *
 * Upstream issue:
 * - https://github.com/dcmjs-org/dcmjs/issues/130 (category A — synthetic)
 *   Symptom: the DICOM standard pads odd-length string values (SH, LO, PN,
 *   CS, ...) with a trailing SPACE, but files in the wild routinely pad
 *   with 0x00 instead (UI-style padding applied to text VRs). dcmjs keeps
 *   the trailing NUL character in the parsed value ("CT\0" instead of
 *   "CT"), while DCMTK and pydicom strip it. The reporter notes the
 *   commented-out handling in ValueRepresentation's PersonName and asks
 *   for NUL stripping across the string VRs.
 *
 * Findings pinned here: both the eager path (DicomMessage.readFile) and
 * the streaming path (fromPart10Stream → toNaturalized) strip trailing
 * 0x00 pad bytes on SH/LO/PN/CS values (fixed in this arc — read-side
 * trims in ValueRepresentation now strip NULs alongside spaces; writes
 * still pad with spaces per the standard, and _rawValue keeps the original
 * bytes for lossless round trips). Space padding is stripped correctly for
 * CS/SH/LO (control test kept green below).
 *
 * The synthetic file is deliberately malformed (NUL padding is not legal
 * for these VRs), hence validationLog is silenced.
 */

import dcmjs from "../../src/index.js";
import { validationLog } from "../../src/log.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";

validationLog.setLevel(5);

const { DicomMessage } = dcmjs.data;
const { DicomEventStream } = dcmjs.eventStream;

const NUL = "\u0000";

/** Serialize one explicit-LE short-form element with verbatim payload bytes. */
function element(group, elem, vr, payload) {
    const p = Uint8Array.from(payload, c => c.charCodeAt(0));
    if (p.length % 2 !== 0) {
        throw new Error("test payloads must be even-length");
    }
    const out = new Uint8Array(8 + p.length);
    const view = new DataView(out.buffer);
    view.setUint16(0, group, true);
    view.setUint16(2, elem, true);
    out[4] = vr.charCodeAt(0);
    out[5] = vr.charCodeAt(1);
    view.setUint16(6, p.length, true);
    out.set(p, 8);
    return out;
}

/** Append hand-built dataset elements to a valid Part 10 buffer. */
function part10WithRawElements(extraElements) {
    const base = new Uint8Array(createSampleDicom());
    const total =
        base.length + extraElements.reduce((sum, e) => sum + e.length, 0);
    const joined = new Uint8Array(total);
    joined.set(base, 0);
    let offset = base.length;
    for (const e of extraElements) {
        joined.set(e, offset);
        offset += e.length;
    }
    return joined;
}

/** SH/LO/PN/CS values padded to even length with 0x00 instead of space. */
function nulPaddedPart10() {
    return part10WithRawElements([
        element(0x0008, 0x0050, "SH", "ACC" + NUL), // AccessionNumber
        element(0x0008, 0x0060, "CS", "CT" + NUL + NUL), // Modality
        element(0x0008, 0x103e, "LO", "desc1" + NUL), // SeriesDescription
        element(0x0010, 0x0010, "PN", "Doe^John" + NUL + NUL) // PatientName
    ]);
}

describe("issue #130 — trailing 0x00 padding must be stripped on read", () => {
    // Fixed in this arc: read-side string trims (rtrim + the CS/SH/LO/PN
    // applyFormatting) strip trailing NULs like DCMTK/pydicom.
    it("#130: eager readFile strips trailing NUL pad bytes on SH/CS/LO/PN", () => {
        const dicomDict = DicomMessage.readFile(nulPaddedPart10().buffer);
        expect(dicomDict.dict["00080050"].Value).toEqual(["ACC"]);
        expect(dicomDict.dict["00080060"].Value).toEqual(["CT"]);
        expect(dicomDict.dict["0008103E"].Value).toEqual(["desc1"]);
        expect(dicomDict.dict["00100010"].Value).toEqual([
            { Alphabetic: "Doe^John" }
        ]);
    });

    // Fixed in this arc: the streaming path shares the VR applyFormatting
    // trims, so it strips the NUL padding identically to eager.
    it("#130: streaming path strips trailing NUL pad bytes on SH/CS/LO/PN", async () => {
        const dataset = await DicomEventStream.fromPart10Stream(
            nulPaddedPart10()
        ).toNaturalized();
        expect(dataset.AccessionNumber).toBe("ACC");
        expect(dataset.Modality).toBe("CT");
        expect(dataset.SeriesDescription).toBe("desc1");
        expect(String(dataset.PatientName)).toBe("Doe^John");
    });

    it("control: standard SPACE padding is stripped on CS/SH/LO in both paths", async () => {
        const joined = part10WithRawElements([
            element(0x0008, 0x0050, "SH", "ACC "), // odd value + 1 pad space
            element(0x0008, 0x0060, "CS", "CT  "),
            element(0x0008, 0x103e, "LO", "desc1 ")
        ]);
        const dicomDict = DicomMessage.readFile(joined.buffer);
        expect(dicomDict.dict["00080050"].Value).toEqual(["ACC"]);
        expect(dicomDict.dict["00080060"].Value).toEqual(["CT"]);
        expect(dicomDict.dict["0008103E"].Value).toEqual(["desc1"]);

        const dataset = await DicomEventStream.fromPart10Stream(
            joined
        ).toNaturalized();
        expect(dataset.AccessionNumber).toBe("ACC");
        expect(dataset.Modality).toBe("CT");
        expect(dataset.SeriesDescription).toBe("desc1");
    });
});
