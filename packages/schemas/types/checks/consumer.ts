// tsc gate for the generated types. Compiled by `npm run check:types`;
// never bundled. Positive cases must compile; @ts-expect-error lines must fail.
import type {
    NaturalizedDataset,
    PersonName,
    BinaryValue,
    AttributeRule
} from "../dcmjs-schema";
import { getAttributeRule, naturalizedRules } from "../dcmjs-schema";

declare const ds: NaturalizedDataset;

// The module exports type-check (no TS2305)
const rule: AttributeRule | undefined = getAttributeRule("00100020");
const ruleKeyword: string | undefined = rule?.keyword;
const envelopeValues: string = naturalizedRules.envelope.values;

// VM 1 -> scalar; a present-but-empty element is null
const patientId: string | null | undefined = ds.PatientID;

// VM 2-n -> array even with one value (the contract that kills Array.isArray guards)
const imageType: (string | null)[] | null | undefined = ds.ImageType;
const firstType: string | null | undefined = ds.ImageType?.[0];

// DS VM 2 -> number list; list entries can be null
const spacing: (number | null)[] | null | undefined = ds.PixelSpacing;

// PN -> component object
const pn: PersonName | null | undefined = ds.PatientName;
const alpha: string | undefined = ds.PatientName?.Alphabetic;

// SQ -> dataset array, or the item itself when the sequence has one item
const shared: NaturalizedDataset | NaturalizedDataset[] | null | undefined =
    ds.SharedFunctionalGroupsSequence;

// Binary: a frame list, or one bulk reference object
const pixels: BinaryValue | BinaryValue[] | null | undefined = ds.PixelData;
const firstFrame: BinaryValue | undefined = Array.isArray(ds.PixelData)
    ? ds.PixelData[0]
    : undefined;

// Negative cases — these MUST be type errors:
// @ts-expect-error ImageType is a list, not a string (VM 2-n stays a list)
const wrongScalar: string = ds.ImageType;
// @ts-expect-error PatientID is a scalar, not an array (VM 1)
const wrongArray: string[] = ds.PatientID;
// @ts-expect-error PatientID can be null — string alone does not hold it
const missedNull: string | undefined = ds.PatientID;
// @ts-expect-error PixelSpacing elements are numbers (or null), not strings
const wrongElem: string = ds.PixelSpacing![0];

export {
    rule,
    ruleKeyword,
    envelopeValues,
    patientId,
    imageType,
    firstType,
    firstFrame,
    spacing,
    pn,
    alpha,
    shared,
    pixels,
    wrongScalar,
    wrongArray,
    missedNull,
    wrongElem
};
