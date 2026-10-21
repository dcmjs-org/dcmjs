// Moved to packages/core; this shim keeps the old import path working.
// It imports @dcmjs-org/core, so the ESM build keeps one copy (WRAP-IMP-2).
export { log, validationLog } from "@dcmjs-org/core";
export { log as default } from "@dcmjs-org/core";
