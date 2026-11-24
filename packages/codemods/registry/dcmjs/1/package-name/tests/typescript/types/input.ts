import type { data } from "dcmjs";
import dcmjs = require("dcmjs");
declare module "dcmjs";
type Dict = import("dcmjs").data.DicomDict;
