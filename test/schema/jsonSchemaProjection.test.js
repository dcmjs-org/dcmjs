import { readFileSync } from "fs";
import { join } from "path";

const schema = JSON.parse(
    readFileSync(
        join(__dirname, "../../schema/naturalized.schema.json"),
        "utf8"
    )
);

describe("JSON-Schema projection", () => {
    test("declares draft 2020-12 and the catalog version", () => {
        expect(schema.$schema).toBe(
            "https://json-schema.org/draft/2020-12/schema"
        );
        expect(schema["x-dicom-schema-version"]).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("VM 2-n attribute is an array with minItems", () => {
        expect(schema.properties.ImageType).toEqual({
            type: "array",
            items: { type: "string", maxLength: 16, pattern: "^[A-Z0-9 _]*$" },
            minItems: 2,
            "x-dicom-vr": "CS",
            "x-dicom-vm": "2-n",
            "x-dicom-tag": "00080008"
        });
    });

    test("VM 1 attribute is a scalar with VR format constraints inlined", () => {
        expect(schema.properties.StudyDate).toEqual({
            type: "string",
            pattern: "^\\d{8}$",
            "x-dicom-vr": "DA",
            "x-dicom-vm": "1",
            "x-dicom-tag": "00080020"
        });
    });

    test("sequences reference the dataset schema recursively", () => {
        expect(schema.properties.SharedFunctionalGroupsSequence).toEqual({
            type: "array",
            items: { $ref: "#" },
            "x-dicom-vr": "SQ",
            "x-dicom-vm": "1",
            "x-dicom-tag": "52009229"
        });
    });

    test("additionalProperties stays open for private/unknown keys", () => {
        expect(schema.additionalProperties).toBe(true);
    });
});
