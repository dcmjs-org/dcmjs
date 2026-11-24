import type { data } from "@dcmjs-org/dcmjs";
import dcmjs = require("@dcmjs-org/dcmjs");
declare module "@dcmjs-org/dcmjs";
type Dict = import("@dcmjs-org/dcmjs").data.DicomDict;
