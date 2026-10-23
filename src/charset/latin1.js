// Moved to packages/core; this shim keeps the old import path working.
// It imports @dcmjs-org/core, so the ESM build keeps one copy of it.
export { createDecoder, createLatin1Decoder } from "@dcmjs-org/core";
