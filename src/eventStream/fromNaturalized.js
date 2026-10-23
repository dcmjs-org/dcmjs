// Lives in packages/parser; this shim keeps the src/eventStream import path.
// It imports @dcmjs-org/parser, so the ESM build keeps one copy of it.
export { fromNaturalized } from "@dcmjs-org/parser";
