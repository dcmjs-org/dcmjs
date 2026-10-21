// Moved to packages/parser; this shim keeps the old import path working.
// It imports @dcmjs-org/parser, so the ESM build keeps one copy (WRAP-IMP-2).
// The side-effect import wires the eager-reader seam (see decodeCore), so
// direct consumers of this path keep the reach the static DicomMessage
// import gave them before the move.
import "../DicomMessage.js";
export { fromPart10Stream } from "@dcmjs-org/parser";
