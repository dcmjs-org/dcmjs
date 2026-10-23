// Moved to packages/parser; this shim keeps the old import path working.
// It imports @dcmjs-org/parser, so the ESM build keeps one copy of it.
export { emitEntry, fromDataSet } from "@dcmjs-org/parser";
