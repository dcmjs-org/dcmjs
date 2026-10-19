// The public surface of @dcmjs-org/legacy.
export { DicomMessage, singleVRs } from "./DicomMessage.js";
export { DicomDict } from "./DicomDict.js";
export { AsyncDicomReader } from "./AsyncDicomReader.js";
export {
    datasetToBlob,
    datasetToBuffer,
    datasetToDict
} from "./datasetToBlob.js";
// The 0.x ValueRepresentation, with the static addTagAccessors (a no-op).
export { ValueRepresentation } from "./ValueRepresentation.js";
export { addTagAccessors } from "./tagAccessors.js";
// Historically part of the legacy surface; the code lives in @dcmjs-org/core.
export {
    DicomMetaDictionary,
    BufferStream,
    ReadBufferStream,
    WriteBufferStream,
    DeflatedReadBufferStream,
    SplitDataView
} from "@dcmjs-org/core";
