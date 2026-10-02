// The public surface of @dcmjs/legacy.
export { DicomMessage, singleVRs } from "./DicomMessage.js";
export { DicomDict } from "./DicomDict.js";
export { AsyncDicomReader } from "./AsyncDicomReader.js";
export {
    datasetToBlob,
    datasetToBuffer,
    datasetToDict
} from "./datasetToBlob.js";
// Historically part of the legacy surface; the code lives in @dcmjs/core.
export {
    DicomMetaDictionary,
    BufferStream,
    ReadBufferStream,
    WriteBufferStream,
    DeflatedReadBufferStream,
    SplitDataView
} from "@dcmjs/core";
