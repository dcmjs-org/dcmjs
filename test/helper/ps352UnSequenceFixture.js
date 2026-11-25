/**
 * Synthetic bytes for DICOM PS3.5 §6.2.2: an Explicit VR element with wire VR
 * UN and a defined length, whose value starts with the item tag (FFFE,E000),
 * holds a sequence encoded as Implicit VR Little Endian.
 */

import { DicomDict } from "../../src/DicomDict.js";
import { DicomMessage } from "../../src/DicomMessage.js";
import { EXPLICIT_LITTLE_ENDIAN, TagHex } from "../../src/constants/dicom.js";

DicomDict.setDicomMessageClass(DicomMessage);

export const PS352_UN_SEQUENCE_UDI = "*+B220INTUITION040/$$+7INTUITION4.10.1%*";

/** @returns {ArrayBuffer} the UN value: one item with an implicit (0018,1009) */
export function buildUnSequenceValueBytes() {
    const udi = PS352_UN_SEQUENCE_UDI;
    const item = new Uint8Array(16 + udi.length);
    const view = new DataView(item.buffer);
    view.setUint16(0, 0xfffe, true);
    view.setUint16(2, 0xe000, true);
    view.setUint32(4, 8 + udi.length, true);
    view.setUint16(8, 0x0018, true);
    view.setUint16(10, 0x1009, true);
    view.setUint32(12, udi.length, true);
    for (let i = 0; i < udi.length; i++) item[16 + i] = udi.charCodeAt(i);
    return item.buffer;
}

/** @returns {ArrayBuffer} one Explicit VR UN element (0018,100A), tag through value */
export function createPs352UnSequenceDatasetElementBuffer() {
    const value = new Uint8Array(buildUnSequenceValueBytes());
    const element = new Uint8Array(12 + value.length);
    const view = new DataView(element.buffer);
    view.setUint16(0, 0x0018, true);
    view.setUint16(2, 0x100a, true);
    element[4] = 0x55; // "U"
    element[5] = 0x4e; // "N"
    view.setUint32(8, value.length, true);
    element.set(value, 12);
    return element.buffer;
}

/**
 * Minimal Explicit VR Part 10 file (LE by default). The default dataset holds
 * (0018,100A) as UN with the §6.2.2 value bytes.
 */
export function createPs352UnSequencePart10Buffer(
    dict = { "0018100A": { vr: "UN", Value: [buildUnSequenceValueBytes()] } },
    syntax = EXPLICIT_LITTLE_ENDIAN
) {
    const dicomDict = new DicomDict({
        [TagHex.TransferSyntaxUID]: { vr: "UI", Value: [syntax] }
    });
    dicomDict.dict = dict;
    return dicomDict.write();
}
