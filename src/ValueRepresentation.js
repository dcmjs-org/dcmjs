// Moved to packages/core; this shim keeps the old import path working. The
// 0.x surface takes the legacy class, which keeps addTagAccessors (a no-op).
export * from "../packages/core/src/ValueRepresentation.js";
export { ValueRepresentation } from "../packages/legacy/src/ValueRepresentation.js";
