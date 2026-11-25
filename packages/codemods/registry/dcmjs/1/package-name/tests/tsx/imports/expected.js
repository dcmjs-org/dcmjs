import dcmjs from "@dcmjs-org/dcmjs";
import { data } from '@dcmjs-org/dcmjs';
import * as all from "@dcmjs-org/dcmjs";
export { utilities } from "@dcmjs-org/dcmjs";
const legacy = require("@dcmjs-org/dcmjs");
const lazy = await import("@dcmjs-org/dcmjs");
jest.mock("@dcmjs-org/dcmjs");
import build from "dcmjs/build/dcmjs.es.js";
import other from "dcmjs-dimse";
import scoped from "@dcmjs-org/dcmjs";

module.exports = {
  moduleNameMapper: { "^dcmjs$": "<rootDir>/node_modules/dcmjs/build/dcmjs.js" }
};

const label = "dcmjs";
