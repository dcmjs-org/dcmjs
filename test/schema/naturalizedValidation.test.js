import { readFileSync } from "fs";
import { join } from "path";
import Ajv2020 from "ajv/dist/2020";
import dcmjs from "../../src/index.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const schema = JSON.parse(
    readFileSync(
        join(
            __dirname,
            "../../packages/schemas/schema/naturalized.schema.json"
        ),
        "utf8"
    )
);

// strictSchema off: the schema carries x-dicom-* annotation keywords.
const ajv = new Ajv2020({ strictSchema: false, allErrors: true });
const validate = ajv.compile(schema);

// Known value-space divergences between what these files hold and the Part 5
// value formats in the schema. The structural contract (scalar vs list,
// sequences, binary frames) must hold with no exceptions; these entries pin
// the open value-format questions until a maintainer decides the contract
// (pass-through values vs schema-valid values).
const KNOWN_DIVERGENCES = {
    "sample-dicom.dcm": [],
    // zero-length DA naturalizes as "" — the DA pattern has no empty branch
    "sample-sr.dcm": ['/PatientBirthDate must match pattern "^\\d{8}$"'],
    "sample-op.dcm": [
        // the file holds the noncompliant age "24" and the schema passes
        // Part 5 judgement on it
        '/PatientAge must match pattern "^\\d{3}[DWMY]$"',
        // a zero-length DS inside a list naturalizes as a null element
        "/LossyImageCompressionRatio/0 must be number"
    ]
};

describe("naturalized datasets validate against the published schema", () => {
    test.each(Object.keys(KNOWN_DIVERGENCES))("%s", fileName => {
        const buffer = readFileSync(
            join(__dirname, "../../packages/fixtures/dicom", fileName)
        );
        const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
        );
        const dicomDict = DicomMessage.readFile(arrayBuffer);
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        validate(dataset);
        const errors = (validate.errors || []).map(
            e => `${e.instancePath || "(root)"} ${e.message}`
        );
        expect(errors.sort()).toEqual(KNOWN_DIVERGENCES[fileName].sort());
    });
});
