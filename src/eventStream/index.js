/**
 * The dcmjs event-stream contract.
 *
 * The canonical, source-agnostic interchange layer: readers produce event
 * streams, listeners and writers consume them. This module grows as the
 * engine slices land; it currently exports the contract itself and the
 * reference collector used to validate generators against it.
 */
export {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY,
    CONTRACT_VERSION
} from "./EventStreamListener.js";
export { CollectorListener } from "./CollectorListener.js";

import {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY,
    CONTRACT_VERSION
} from "./EventStreamListener.js";
import { CollectorListener } from "./CollectorListener.js";

export default {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY,
    CONTRACT_VERSION,
    CollectorListener
};
