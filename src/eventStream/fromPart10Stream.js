// Moved to packages/parser; this shim keeps the old import path working.
// The side-effect import wires the eager-reader seam (see decodeCore), so
// direct consumers of this path keep the reach the static DicomMessage
// import gave them before the move.
import "../DicomMessage.js";
export * from "../../packages/parser/src/eventStream/fromPart10Stream.js";
