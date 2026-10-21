// Moved to packages/parser; this shim keeps the old import path working.
// It imports @dcmjs-org/parser, so the ESM build keeps one copy (WRAP-IMP-2).
export {
    CONTRACT_VERSION,
    EVENT_STREAM_VOCABULARY,
    EventStreamListener,
    mergeFragmentsPerBotWindow
} from "@dcmjs-org/parser";
