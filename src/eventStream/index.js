/**
 * The dcmjs event-stream contract (refactor slice A).
 *
 * The canonical, source-agnostic interchange layer: readers produce event
 * streams, listeners/writers consume them. See CLAUDE_REFACTOR_PLAN.md and
 * docs at packages/docs for the full architecture.
 */
export {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY,
    CONTRACT_VERSION
} from "./EventStreamListener.js";
export { CollectorListener } from "./CollectorListener.js";
export { NaturalizedListener } from "./NaturalizedListener.js";
export { DicomWebJsonWriter } from "./DicomWebJsonWriter.js";
export { Part10Writer } from "./Part10Writer.js";
export { StreamingPart10Writer } from "./StreamingPart10Writer.js";
export { fromDataSet } from "./fromDataSet.js";
export { fromPart10 } from "./fromPart10.js";
export { fromPart10Stream } from "./fromPart10Stream.js";
export { fromDicomWebJson } from "./fromDicomWebJson.js";
export { createVideoEventSource } from "./fromVideo.js";
export { createEventAsyncIterable } from "./asyncIterator.js";
export { DicomEventStream, Naturalized, DicomWebJson } from "./api.js";

import {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY,
    CONTRACT_VERSION
} from "./EventStreamListener.js";
import { CollectorListener } from "./CollectorListener.js";
import { NaturalizedListener } from "./NaturalizedListener.js";
import { DicomWebJsonWriter } from "./DicomWebJsonWriter.js";
import { Part10Writer } from "./Part10Writer.js";
import { StreamingPart10Writer } from "./StreamingPart10Writer.js";
import { fromDataSet } from "./fromDataSet.js";
import { fromPart10 } from "./fromPart10.js";
import { fromPart10Stream } from "./fromPart10Stream.js";
import { fromDicomWebJson } from "./fromDicomWebJson.js";
import { createVideoEventSource } from "./fromVideo.js";
import { createEventAsyncIterable } from "./asyncIterator.js";
import { DicomEventStream, Naturalized, DicomWebJson } from "./api.js";

export default {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY,
    CONTRACT_VERSION,
    CollectorListener,
    NaturalizedListener,
    DicomWebJsonWriter,
    Part10Writer,
    StreamingPart10Writer,
    fromDataSet,
    fromPart10,
    fromPart10Stream,
    fromDicomWebJson,
    createVideoEventSource,
    createEventAsyncIterable,
    DicomEventStream,
    Naturalized,
    DicomWebJson
};
