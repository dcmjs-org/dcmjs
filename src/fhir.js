// @dcmjs-org/dcmjs/fhir: the @dcmjs-org/fhir sink, plus the v2 fromPart10
// convenience over the classic reader and naturalizer.
import * as fhirSink from "@dcmjs-org/fhir";

// From the default entry, so the reader is the initialized 0.52 one.
import { data } from "./index.js";

export * from "@dcmjs-org/fhir";

/**
 * Parse a DICOM Part 10 ArrayBuffer and map it to FHIR resources.
 * Kept for v2 compatibility; the recommended path is
 * `DicomEventStream.fromPart10(bytes).toFhir()` from
 * `@dcmjs-org/dcmjs/eventStream`.
 * @param {ArrayBuffer} arrayBuffer
 * @param {Object} [options] - toFhir options; options.readOptions is
 *   passed through to DicomMessage.readFile
 * @returns {{ patient: Object|null, imagingStudy: Object|null,
 *   documentReference: Object|null }}
 */
export function fromPart10(arrayBuffer, options = {}) {
    const { readOptions = {}, ...fhirOptions } = options;
    const dicomDict = data.DicomMessage.readFile(arrayBuffer, readOptions);
    const dataset = data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
    return fhirSink.toFhir(dataset, fhirOptions);
}

export default { ...fhirSink, fromPart10 };
