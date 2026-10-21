// packages/encapsulated/test/part10Helpers.js
//
// Round-trip helpers shared by the encapsulated suites: naturalized dataset ->
// Part 10 bytes -> naturalized, through the event-stream engine.

import { DicomMetaDictionary } from "@dcmjs-org/core";
import {
    fromDataSet,
    fromPart10,
    NaturalizedListener
} from "../../parser/src/index.js";
import { Part10Writer } from "../../generator/src/index.js";

export function bytesToString(bytes) {
    return String.fromCharCode(...bytes);
}

/** Naturalized dataset -> Part 10 bytes, with a minted file meta group. */
export async function writePart10(dataset) {
    const meta = DicomMetaDictionary.denaturalizeDataset({
        MediaStorageSOPClassUID: dataset.SOPClassUID,
        MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
        TransferSyntaxUID: dataset._meta.TransferSyntaxUID.Value[0]
    });
    const dict = DicomMetaDictionary.denaturalizeDataset(dataset);
    const writer = new Part10Writer();
    await fromDataSet({ meta, dict }, writer);
    return writer.write();
}

/** Part 10 bytes -> the NaturalizedListener ({ result, meta }). */
export async function readNaturalized(arrayBuffer) {
    const listener = new NaturalizedListener();
    await fromPart10(arrayBuffer, listener);
    return listener;
}
