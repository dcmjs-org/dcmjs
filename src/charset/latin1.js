// Moved to packages/core; this shim keeps the old import path working.
// It imports @dcmjs-org/core, so the ESM build keeps one copy (WRAP-IMP-2).
export { createDecoder, createLatin1Decoder } from "@dcmjs-org/core";
