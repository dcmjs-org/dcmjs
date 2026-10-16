import { readFileSync } from "fs";
import { join } from "path";

const schema = JSON.parse(
    readFileSync(
        join(
            __dirname,
            "../../packages/schemas/schema/naturalized.schema.json"
        ),
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

    test("VM 2-n attribute is a nullable array with nullable items", () => {
        expect(schema.properties.ImageType).toEqual({
            type: ["array", "null"],
            items: { type: ["string", "null"] },
            minItems: 2,
            "x-dicom-format": { maxLength: 16, pattern: "^[A-Z0-9 _]*$" },
            "x-dicom-vr": "CS",
            "x-dicom-vm": "2-n",
            "x-dicom-tag": "00080008"
        });
    });

    test("VM 1 attribute is a nullable scalar; the Part 5 format is an annotation", () => {
        expect(schema.properties.StudyDate).toEqual({
            type: ["string", "null"],
            "x-dicom-format": { pattern: "^\\d{8}$" },
            "x-dicom-vr": "DA",
            "x-dicom-vm": "1",
            "x-dicom-tag": "00080020"
        });
    });

    test("fixed VM carries both bounds", () => {
        expect(schema.properties.PixelSpacing).toMatchObject({
            type: ["array", "null"],
            minItems: 2,
            maxItems: 2
        });
    });

    test("sequences accept a dataset array, the single item, or null", () => {
        expect(schema.properties.SharedFunctionalGroupsSequence).toEqual({
            $ref: "#/$defs/sequenceValue",
            "x-dicom-vr": "SQ",
            "x-dicom-vm": "1",
            "x-dicom-tag": "52009229"
        });
        expect(schema.$defs.sequenceValue).toEqual({
            anyOf: [
                { type: "null" },
                { type: "array", items: { $ref: "#" } },
                { $ref: "#" }
            ]
        });
    });

    test("binary values accept a frame list, a bulk reference, or null", () => {
        expect(schema.properties.PixelData).toEqual({
            $ref: "#/$defs/binaryValue",
            "x-dicom-vr": "OB/OW",
            "x-dicom-vm": "1",
            "x-dicom-tag": "7FE00010"
        });
        expect(schema.$defs.binaryValue.anyOf).toHaveLength(3);
    });

    test("PN values are component objects through $defs", () => {
        expect(schema.properties.PatientName).toEqual({
            $ref: "#/$defs/personName",
            "x-dicom-vr": "PN",
            "x-dicom-vm": "1",
            "x-dicom-tag": "00100010"
        });
        expect(schema.$defs.personName.anyOf[1].properties.Alphabetic).toEqual({
            type: ["string", "null"]
        });
    });

    test("additionalProperties stays open for private/unknown keys", () => {
        expect(schema.additionalProperties).toBe(true);
    });
});
