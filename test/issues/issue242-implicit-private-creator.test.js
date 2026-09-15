/**
 * Issue #242 — "Invalid VR of the private creator tag of the 'Implicit VR
 * Endian' typed DICOM file"
 * https://github.com/dcmjs-org/dcmjs/issues/242
 *
 * Symptom: parsing an Implicit VR Little Endian (1.2.840.10008.1.2) file,
 * dcmjs assigned VR UN to the private creator element (gggg,0010-00FF
 * with gggg odd) instead of LO as PS3.5 §7.8.1 requires ("The VR of the
 * private identification code shall be LO"); dcmdump shows LO for the
 * same file.
 *
 * Triage: A — synthetic reproducer: createSampleDicom with meta
 * TransferSyntaxUID 1.2.840.10008.1.2 (the helper writes the body with
 * the meta's syntax, so (0009,0010) goes on the wire as tag + 4-byte
 * length + "PRIVATE_CREATOR " with no VR bytes).
 *
 * 1.0 contract asserted (green): the implicit reader resolves
 * non-dictionary tags via Tag.isPrivateCreator() → VR LO with the value
 * intact (DicomMessage._readTag). The private DATA element (0009,1001)
 * legitimately stays UN (no private dictionary registered for this
 * creator) with its raw bytes intact — also pinned so a value-mangling
 * regression is caught. Both the eager and streaming paths are covered.
 *
 * Helper note: sampleDicomPart10's default meta writes a stray
 * (0000,000F) element (artifact of the missing TagHex
 * MediaStorageSOPClassUID constant). The eager reader consumes it inside
 * the meta window, but the streaming reader ends FMI at the first
 * non-0002 group and would feed those explicit-VR bytes to the IMPLICIT
 * body parser (misread length ~1.7 MB → "truncated" error). The
 * exciseStrayMetaElement helper below removes it so this file tests the
 * private-creator contract, not the helper quirk.
 */

import dcmjs from "../../src/index.js";
import { DicomMessage } from "../../src/DicomMessage.js";
import { validationLog } from "../../src/log.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";
import { TagHex } from "../../src/constants/dicom.js";

validationLog.setLevel(5);

const { DicomEventStream, CollectorListener } = dcmjs.eventStream;

const IMPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2";
const CREATOR_TAG = "00090010";
const PRIVATE_DATA_TAG = "00091001";
const CREATOR_VALUE = "PRIVATE_CREATOR";
const PRIVATE_DATA_VALUE = "private value!"; // even length: written verbatim

/**
 * Remove the helper's stray (0000,000F) meta element and patch the
 * (0002,0000) group length accordingly (see docblock).
 */
function exciseStrayMetaElement(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const metaLength = view.getUint32(140, true);
    const metaStart = 144;
    const metaEnd = metaStart + metaLength;
    let offset = metaStart;
    while (offset < metaEnd) {
        const group = view.getUint16(offset, true);
        const element = view.getUint16(offset + 2, true);
        // All helper meta elements use the explicit short form:
        // tag(4) + VR(2) + length(2) + value.
        const valueLength = view.getUint16(offset + 6, true);
        const total = 8 + valueLength;
        if (group === 0x0000 && element === 0x000f) {
            const out = new Uint8Array(buffer.byteLength - total);
            out.set(bytes.subarray(0, offset));
            out.set(bytes.subarray(offset + total), offset);
            new DataView(out.buffer).setUint32(140, metaLength - total, true);
            return out.buffer;
        }
        offset += total;
    }
    return buffer;
}

function implicitSample() {
    return exciseStrayMetaElement(
        createSampleDicom({
            meta: {
                [TagHex.TransferSyntaxUID]: {
                    vr: "UI",
                    Value: [IMPLICIT_LITTLE_ENDIAN]
                }
            },
            dict: {
                [CREATOR_TAG]: { vr: "LO", Value: [CREATOR_VALUE] },
                [PRIVATE_DATA_TAG]: { vr: "LO", Value: [PRIVATE_DATA_VALUE] }
            }
        })
    );
}

function expectCreatorContract(dict) {
    const creator = dict[CREATOR_TAG];
    expect(creator).toBeDefined();
    // PS3.5 7.8.1: private identification code VR shall be LO — not UN.
    expect(creator.vr).toBe("LO");
    expect(creator.Value).toEqual([CREATOR_VALUE]);
}

describe("issue #242 — implicit-VR private creator resolves to LO", () => {
    it("eager readFile: (0009,0010) parses as LO with the value intact", () => {
        const { dict } = DicomMessage.readFile(implicitSample());
        expectCreatorContract(dict);
    });

    it("eager readFile: the private data element keeps its bytes (UN without a private dictionary)", () => {
        const { dict } = DicomMessage.readFile(implicitSample());
        const privateElement = dict[PRIVATE_DATA_TAG];
        expect(privateElement).toBeDefined();
        expect(privateElement.vr).toBe("UN");
        // UN surfaces raw bytes; the LO-written payload must be intact.
        const [bytes] = privateElement.Value;
        expect(bytes instanceof ArrayBuffer).toBe(true);
        expect(new TextDecoder("ascii").decode(new Uint8Array(bytes))).toBe(
            PRIVATE_DATA_VALUE
        );
    });

    it("streaming path: (0009,0010) parses as LO with the value intact", async () => {
        const collector = new CollectorListener();
        await DicomEventStream.fromPart10Stream(
            new Uint8Array(implicitSample())
        ).process(collector);
        expectCreatorContract(collector.result.dict);
    });
});
