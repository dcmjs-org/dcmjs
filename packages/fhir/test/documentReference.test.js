// packages/fhir/test/documentReference.test.js
//
// FHIR DocumentReference from Encapsulated PDF instances — the "PDF out of
// PACS" mapping. Input datasets are built with dcmjs.encapsulated (the
// same shapes a parsed Part 10 Encapsulated PDF produces) and, for the
// round-trip case, actually serialized and re-read.

import fs from "fs";
import path from "path";
import dcmjs from "../../../src/index.js";
import { validationLog } from "../../../src/log.js";
import {
    toFhir,
    toBundle,
    documentReferenceFromDataset
} from "../src/index.js";
import { bytesToBase64 } from "../src/helpers.js";

validationLog.setLevel(5);

const { DicomMessage, DicomMetaDictionary, datasetToBuffer } = dcmjs.data;
const { encapsulatePdf } = dcmjs.encapsulated;

const PDF_STRING =
    "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "trailer<</Size 2/Root 1 0 R>>\n" +
    "%%EOF";
const PDF_BYTES = new TextEncoder().encode(PDF_STRING);

const FIXTURE = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "test",
    "sample-dicom.dcm"
);

function buildPdfDataset(options = {}) {
    return encapsulatePdf(PDF_BYTES, {
        PatientName: "Doe^Jane",
        PatientID: "MRN-42",
        DocumentTitle: "Discharge Summary",
        StudyInstanceUID: "1.2.3.4.5",
        ContentDate: "20260803",
        ContentTime: "101500",
        ...options
    });
}

describe("bytesToBase64", () => {
    test("encodes bytes without Buffer", () => {
        const encoded = bytesToBase64(new TextEncoder().encode("dcmjs!"));
        expect(encoded).toEqual("ZGNtanMh");
    });
});

describe("documentReferenceFromDataset", () => {
    test("maps an Encapsulated PDF dataset to a DocumentReference", () => {
        const dataset = buildPdfDataset();
        const documentReference = documentReferenceFromDataset(dataset);

        expect(documentReference.resourceType).toBe("DocumentReference");
        expect(documentReference.status).toBe("current");
        expect(documentReference.masterIdentifier).toEqual({
            system: "urn:dicom:uid",
            value: `urn:oid:${dataset.SOPInstanceUID}`
        });
        expect(documentReference.description).toBe("Discharge Summary");
        expect(documentReference.date).toMatch(/^2026-08-03T10:15:00/);

        const attachment = documentReference.content[0].attachment;
        expect(attachment.contentType).toBe("application/pdf");
        expect(attachment.title).toBe("Discharge Summary");
        expect(attachment.size).toBe(PDF_BYTES.byteLength);
        // base64 round-trip is byte-identical to the original PDF
        expect(Buffer.from(attachment.data, "base64").toString("latin1")).toBe(
            PDF_STRING
        );

        // Attached to the originating study
        expect(documentReference.context.related[0].identifier).toEqual({
            system: "urn:dicom:uid",
            value: "urn:oid:1.2.3.4.5"
        });
    });

    test("honors subject and includeData options", () => {
        const dataset = buildPdfDataset();
        const documentReference = documentReferenceFromDataset(dataset, {
            subject: { reference: "Patient/12345" },
            includeData: false
        });

        expect(documentReference.subject).toEqual({
            reference: "Patient/12345"
        });
        const attachment = documentReference.content[0].attachment;
        expect(attachment.data).toBeUndefined();
        expect(attachment.size).toBe(PDF_BYTES.byteLength);
    });

    test("uses ConceptNameCodeSequence for type when present", () => {
        const dataset = buildPdfDataset({
            ConceptNameCodeSequence: {
                CodeValue: "18842-5",
                CodingSchemeDesignator: "LN",
                CodeMeaning: "Discharge summary"
            }
        });
        const documentReference = documentReferenceFromDataset(dataset);
        expect(documentReference.type.coding[0].code).toBe("18842-5");
        expect(documentReference.type.coding[0].display).toBe(
            "Discharge summary"
        );
    });

    test("returns null for a non-encapsulated dataset", () => {
        const arrayBuffer = fs.readFileSync(FIXTURE).buffer;
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(arrayBuffer).dict
        );
        expect(documentReferenceFromDataset(dataset)).toBeNull();
    });

    test("survives a Part 10 round trip (odd-length OB padding)", () => {
        const source = buildPdfDataset();
        const buffer = datasetToBuffer(source);
        const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
        );
        const readBack = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(arrayBuffer).dict
        );

        const documentReference = documentReferenceFromDataset(readBack);
        const attachment = documentReference.content[0].attachment;
        // Trailing NUL pad trimmed: size and payload match the original PDF
        expect(attachment.size).toBe(PDF_BYTES.byteLength);
        expect(Buffer.from(attachment.data, "base64").toString("latin1")).toBe(
            PDF_STRING
        );
    });
});

describe("toFhir / toBundle integration", () => {
    test("toFhir yields { patient, documentReference } for encapsulated PDFs", () => {
        const { patient, imagingStudy, documentReference } = toFhir(
            buildPdfDataset()
        );
        expect(patient.resourceType).toBe("Patient");
        expect(patient.identifier[0].value).toBe("MRN-42");
        expect(imagingStudy).toBeNull();
        expect(documentReference.resourceType).toBe("DocumentReference");
    });

    test("toFhir still yields imagingStudy (and null documentReference) for images", () => {
        const arrayBuffer = fs.readFileSync(FIXTURE).buffer;
        const dataset = DicomMetaDictionary.naturalizeDataset(
            DicomMessage.readFile(arrayBuffer).dict
        );
        const { imagingStudy, documentReference } = toFhir(dataset);
        expect(imagingStudy.resourceType).toBe("ImagingStudy");
        expect(documentReference).toBeNull();
    });

    test("toBundle includes DocumentReference entries", () => {
        const bundle = toBundle([buildPdfDataset()]);
        const resourceTypes = bundle.entry.map(
            entry => entry.resource.resourceType
        );
        expect(resourceTypes).toContain("Patient");
        expect(resourceTypes).toContain("DocumentReference");
        expect(bundle.total).toBe(bundle.entry.length);
    });
});
