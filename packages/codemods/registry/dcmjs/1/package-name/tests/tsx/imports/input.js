import dcmjs from "dcmjs";
import { data } from 'dcmjs';
import * as all from "dcmjs";
export { utilities } from "dcmjs";
const legacy = require("dcmjs");
const lazy = await import("dcmjs");
jest.mock("dcmjs");
import build from "dcmjs/build/dcmjs.es.js";
import other from "dcmjs-dimse";
import scoped from "@dcmjs-org/dcmjs";

module.exports = {
  moduleNameMapper: { "^dcmjs$": "<rootDir>/node_modules/dcmjs/build/dcmjs.js" }
};

const label = "dcmjs";
