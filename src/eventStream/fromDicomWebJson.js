// Moved to packages/parser; this shim keeps the old import path working.
// It imports @dcmjs-org/parser, so the ESM build keeps one copy (WRAP-IMP-2).
export { base64ToArrayBuffer, fromDicomWebJson } from "@dcmjs-org/parser";
