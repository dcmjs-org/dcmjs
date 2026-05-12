/**
 * Synthetic Part 10 / dataset bytes for DICOM PS3.5 6.2.2: an Explicit VR
 * element with wire VR UN and defined length whose value begins with the
 * item delimiter (FFFE,E000) is read as a sequence using Implicit VR LE for
 * the value bytes.
 */

import { DicomDict } from "../../src/DicomDict.js";
import { DicomMessage } from "../../src/DicomMessage.js";
import {
    EXPLICIT_LITTLE_ENDIAN,
    TagHex
} from "../../src/constants/dicom.js";

DicomDict.setDicomMessageClass(DicomMessage);

export const PS352_UN_SEQUENCE_UDI =
    "*+B220INTUITION040/$$+7INTUITION4.10.1%*";

/**
 * @returns {ArrayBuffer} UN element value only (item wrapper + implicit item dataset).
 */
function buildUnSequenceValueBytes() {
    const udi = PS352_UN_SEQUENCE_UDI;
    const udiBytes = new Uint8Array(udi.length);
    for (let i = 0; i < udi.length; i++) udiBytes[i] = udi.charCodeAt(i);

    const itemPayload = new Uint8Array(4 + 4 + udi.length);
    const ipView = new DataView(itemPayload.buffer);
    ipView.setUint16(0, 0x0018, true);
    ipView.setUint16(2, 0x1009, true);
    ipView.setUint32(4, udi.length, true);
    itemPayload.set(udiBytes, 8);

    const itemBytes = new Uint8Array(4 + 4 + itemPayload.length);
    const ibView = new DataView(itemBytes.buffer);
    ibView.setUint16(0, 0xfffe, true);
    ibView.setUint16(2, 0xe000, true);
    ibView.setUint32(4, itemPayload.length, true);
    itemBytes.set(itemPayload, 8);

    return itemBytes.buffer.slice(
        itemBytes.byteOffset,
        itemBytes.byteOffset + itemBytes.byteLength
    );
}

/**
 * Single explicit-VR UN dataset element (tag through value) for low-level
 * parser tests (e.g. DicomMessage._readTag).
 *
 * @returns {ArrayBuffer}
 */
export function createPs352UnSequenceDatasetElementBuffer() {
    const valueBuf = buildUnSequenceValueBytes();
    const itemBytes = new Uint8Array(valueBuf);
    const unElement = new Uint8Array(4 + 2 + 2 + 4 + itemBytes.length);
    const ueView = new DataView(unElement.buffer);
    ueView.setUint16(0, 0x0018, true);
    ueView.setUint16(2, 0x100a, true);
    unElement[4] = 0x55;
    unElement[5] = 0x4e;
    ueView.setUint16(6, 0, true);
    ueView.setUint32(8, itemBytes.length, true);
    unElement.set(itemBytes, 12);
    return unElement.buffer;
}

/**
 * Minimal Part 10 file: meta (Explicit LE) + dataset containing (0018,100A)
 * as UN with the PS3.5 6.2.2-shaped value bytes.
 *
 * @returns {ArrayBuffer}
 */
export function createPs352UnSequencePart10Buffer() {
    const dicomDict = new DicomDict({
        [TagHex.TransferSyntaxUID]: {
            vr: "UI",
            Value: [EXPLICIT_LITTLE_ENDIAN]
        }
    });
    dicomDict.dict = {
        "0018100A": {
            vr: "UN",
            Value: [buildUnSequenceValueBytes()]
        }
    };
    return dicomDict.write();
}
