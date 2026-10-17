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

function expectValid(dataset) {
    validate(dataset);
    const errors = (validate.errors || []).map(
        e => `${e.instancePath || "(root)"} ${e.message}`
    );
    expect(errors).toEqual([]);
}

describe("naturalized datasets validate against the published schema", () => {
    // The schema describes what dcmjs returns (envelope.values:
    // "asReturned"), so a real file validates with no exceptions — also
    // when it holds an empty date or a Part 5 violation like an age of
    // "24"; vrFormats documents those formats without enforcing them.
    test.each(["sample-dicom.dcm", "sample-sr.dcm", "sample-op.dcm"])(
        "%s",
        fileName => {
            const buffer = readFileSync(
                join(__dirname, "../../packages/fixtures/dicom", fileName)
            );
            const arrayBuffer = buffer.buffer.slice(
                buffer.byteOffset,
                buffer.byteOffset + buffer.byteLength
            );
            const dicomDict = DicomMessage.readFile(arrayBuffer);
            expectValid(DicomMetaDictionary.naturalizeDataset(dicomDict.dict));
        }
    );

    test("a present-but-empty element naturalizes as null and validates", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset({
            "00100020": { vr: "LO" }
        });
        expect(dataset.PatientID).toBeNull();
        expectValid(dataset);
    });

    test("a bulk-data reference naturalizes as one object and validates", () => {
        const byUri = DicomMetaDictionary.naturalizeDataset({
            "7FE00010": { vr: "OB", BulkDataURI: "http://host/bulk/1" }
        });
        expect(byUri.PixelData).toEqual({ BulkDataURI: "http://host/bulk/1" });
        expectValid(byUri);

        const inline = DicomMetaDictionary.naturalizeDataset({
            "7FE00010": { vr: "OB", InlineBinary: "AAAA" }
        });
        expect(inline.PixelData).toEqual({ InlineBinary: "AAAA" });
        expectValid(inline);
    });

    test("a null entry inside a list validates", () => {
        const dataset = DicomMetaDictionary.naturalizeDataset({
            "00282112": { vr: "DS", Value: [1.5, null] }
        });
        expect(dataset.LossyImageCompressionRatio).toEqual([1.5, null]);
        expectValid(dataset);
    });
});
