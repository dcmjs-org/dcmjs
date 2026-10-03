// tsc gate for the generated D22 types. Compiled by `npm run check:types`;
// never bundled. Positive cases must compile; @ts-expect-error lines must fail.
import type {
    NaturalizedDataset,
    PersonName,
    BinaryValue
} from "../dcmjs-schema";

declare const ds: NaturalizedDataset;

// VM 1 -> scalar
const patientId: string | undefined = ds.PatientID;

// VM 2-n -> array even with one value (the contract that kills Array.isArray guards)
const imageType: string[] | undefined = ds.ImageType;
const firstType: string | undefined = ds.ImageType?.[0];

// DS VM 2 -> number[]
const spacing: number[] | undefined = ds.PixelSpacing;

// PN -> component object (D13)
const pn: PersonName | undefined = ds.PatientName;
const alpha: string | undefined = ds.PatientName?.Alphabetic;

// SQ -> dataset array
const shared: NaturalizedDataset[] | undefined =
    ds.SharedFunctionalGroupsSequence;

// Binary
const pixels: BinaryValue | undefined = ds.PixelData;

// Negative cases — these MUST be type errors:
// @ts-expect-error ImageType is string[], not string (VM 2-n stays a list)
const wrongScalar: string = ds.ImageType;
// @ts-expect-error PatientID is a scalar, not an array (VM 1)
const wrongArray: string[] = ds.PatientID;
// @ts-expect-error PixelSpacing elements are numbers
const wrongElem: string = ds.PixelSpacing![0];

export {
    patientId,
    imageType,
    firstType,
    spacing,
    pn,
    alpha,
    shared,
    pixels,
    wrongScalar,
    wrongArray,
    wrongElem
};
