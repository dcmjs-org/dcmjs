/**
 * The dcmjs event-stream contract.
 *
 * The canonical, source-agnostic interchange layer: readers produce event
 * streams, listeners and writers consume them. This module grows as the
 * engine slices land; it currently exports the contract itself, the
 * reference collector used to validate generators against it, and the
 * DICOMweb JSON and dataset sources.
 */
export {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY,
    CONTRACT_VERSION
} from "./EventStreamListener.js";
export { CollectorListener } from "./CollectorListener.js";
export { fromDataSet } from "./fromDataSet.js";
export { fromDicomWebJson } from "./fromDicomWebJson.js";
export { createEventAsyncIterable } from "./asyncIterator.js";

import {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY,
    CONTRACT_VERSION
} from "./EventStreamListener.js";
import { CollectorListener } from "./CollectorListener.js";
import { fromDataSet } from "./fromDataSet.js";
import { fromDicomWebJson } from "./fromDicomWebJson.js";
import { createEventAsyncIterable } from "./asyncIterator.js";

export default {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY,
    CONTRACT_VERSION,
    CollectorListener,
    fromDataSet,
    fromDicomWebJson,
    createEventAsyncIterable
};
