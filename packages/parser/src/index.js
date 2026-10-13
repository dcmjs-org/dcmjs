// The public surface of @dcmjs-org/parser: the event-stream contract and the
// reading side of the engine — every generator that turns an input into
// contract events, and the listeners that collect or naturalize them. The
// writer sinks live in @dcmjs-org/generator; the DicomEventStream facade that
// spans both sides stays with the dcmjs wrapper.

// TEMPORARY dependency on @dcmjs-org/legacy: loading it wires the eager reader
// that decodeCore.requireEagerReader returns. Remove this import and the
// package.json dependency when the undefined-length non-SQ fallback and the
// bare-dataset fallback move to the standard async handling
// (beta-1-release-notes.md).
import "@dcmjs-org/legacy";

export {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY,
    CONTRACT_VERSION,
    mergeFragmentsPerBotWindow
} from "./eventStream/EventStreamListener.js";
export { CollectorListener } from "./eventStream/CollectorListener.js";
export { NaturalizedListener } from "./eventStream/NaturalizedListener.js";
export { fromDataSet, emitEntry } from "./eventStream/fromDataSet.js";
export {
    fromDicomWebJson,
    base64ToArrayBuffer
} from "./eventStream/fromDicomWebJson.js";
export { createEventAsyncIterable } from "./eventStream/asyncIterator.js";
export { fromPart10 } from "./eventStream/fromPart10.js";
export { fromPart10Stream } from "./eventStream/fromPart10Stream.js";
export { emitValues, emitDecodedLeaf } from "./eventStream/emit.js";
