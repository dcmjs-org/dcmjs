// packages/fhir/test/documentReference.test.js
//
// FHIR DocumentReference from Encapsulated PDF instances — the "PDF out of
// PACS" mapping. The v2 original built its input datasets with
// dcmjs.encapsulated.encapsulatePdf; that module belongs to the pdfs wave
// and is not on this branch yet, so buildPdfDataset constructs the same
// naturalized shape directly. The round-trip case still serializes and
// re-reads through @dcmjs-org/legacy (test-only; the package itself never
// imports legacy), and the image fixture naturalizes through
// @dcmjs-org/parser as in toFhir.test.js.

import fs from "fs";
import path from "path";
import { validationLog } from "@dcmjs-org/core";
import { fromPart10, NaturalizedListener } from "@dcmjs-org/parser";
import { datasetToBuffer, DicomMessage } from "@dcmjs-org/legacy";
import { DicomMetaDictionary } from "@dcmjs-org/core";
import {
    toFhir,
    toBundle,
    documentReferenceFromDataset
} from "../src/index.js";
import { bytesToBase64 } from "../src/helpers.js";

validationLog.setLevel(5);

const ENCAPSULATED_PDF_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.104.1";

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
    "fixtures",
    "dicom",
    "sample-dicom.dcm"
);

async function loadNaturalizedFixture() {
    const buffer = fs.readFileSync(FIXTURE);
    const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );
    const listener = new NaturalizedListener();
    await fromPart10(arrayBuffer, listener);
    return listener.result;
}

/** Standalone ArrayBuffer copy of a byte payload. */
function toArrayBuffer(bytes) {
    return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
    );
}

// The naturalized shape dcmjs.encapsulated.encapsulatePdf emits in v2:
// Encapsulated PDF SOP class, DOC modality, the document as an
// ArrayBuffer, plus the identifying attributes.
function buildPdfDataset(options = {}) {
    return {
        SOPClassUID: ENCAPSULATED_PDF_SOP_CLASS_UID,
        SOPInstanceUID: "1.2.3.4.5.6.7",
        StudyInstanceUID: "1.2.3.4.5",
        SeriesInstanceUID: "1.2.3.4.5.1",
        Modality: "DOC",
        MIMETypeOfEncapsulatedDocument: "application/pdf",
        EncapsulatedDocument: toArrayBuffer(PDF_BYTES),
        PatientName: [{ Alphabetic: "Doe^Jane" }],
        PatientID: "MRN-42",
        DocumentTitle: "Discharge Summary",
        ContentDate: "20260803",
        ContentTime: "101500",
        ...options
    };
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

    test("returns null for a non-encapsulated dataset", async () => {
        const dataset = await loadNaturalizedFixture();
        expect(documentReferenceFromDataset(dataset)).toBeNull();
    });

    test("survives a Part 10 round trip (odd-length OB padding)", () => {
        const source = buildPdfDataset({
            _meta: {
                TransferSyntaxUID: { Value: ["1.2.840.10008.1.2.1"] }
            }
        });
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

    // Regression for review finding 8: the event-stream naturalizer wraps
    // binary elements with no decoded Value as { InlineBinary } (base64
    // string, ArrayBuffer, or view). payloadBytes never unwrapped that
    // shape — new Uint8Array(<plain object>) is empty — so every
    // naturalized encapsulated document silently mapped to
    // { size: 0, data: "" }.
    test("unwraps { InlineBinary } base64 byte-exactly (finding 8)", () => {
        const base64 = Buffer.from(PDF_BYTES).toString("base64");
        const dataset = buildPdfDataset({
            EncapsulatedDocument: { InlineBinary: base64 }
        });
        const documentReference = documentReferenceFromDataset(dataset);
        const attachment = documentReference.content[0].attachment;
        expect(attachment.size).toBe(PDF_BYTES.byteLength);
        expect(new Uint8Array(Buffer.from(attachment.data, "base64"))).toEqual(
            PDF_BYTES
        );
    });

    test("unwraps { InlineBinary } ArrayBuffer and view shapes (finding 8)", () => {
        for (const inline of [
            toArrayBuffer(PDF_BYTES),
            new Uint8Array(toArrayBuffer(PDF_BYTES))
        ]) {
            const dataset = buildPdfDataset({
                EncapsulatedDocument: { InlineBinary: inline }
            });
            const attachment =
                documentReferenceFromDataset(dataset).content[0].attachment;
            expect(attachment.size).toBe(PDF_BYTES.byteLength);
            expect(
                new Uint8Array(Buffer.from(attachment.data, "base64"))
            ).toEqual(PDF_BYTES);
        }
    });

    // Regression for review finding 16: the Part 10 writer pads only
    // odd-length OB values, so an even stored length has no pad byte —
    // but the heuristic trimmed a trailing 0x00 anyway, corrupting any
    // even-length payload that genuinely ends in a zero byte (ordinary
    // for STL/OBJ/CDA/octet-stream). EncapsulatedDocumentLength
    // (0042,0015) carries the exact length and must win when present.
    test("EncapsulatedDocumentLength preserves a real trailing zero (finding 16)", () => {
        const payload = new Uint8Array([
            0x53, 0x54, 0x4c, 0x20, 0x62, 0x69, 0x6e, 0x61, 0x72, 0x00
        ]); // 10 bytes, even, ends in a real 0x00
        const dataset = buildPdfDataset({
            MIMETypeOfEncapsulatedDocument: "model/stl",
            EncapsulatedDocument: toArrayBuffer(payload),
            EncapsulatedDocumentLength: 10
        });
        const attachment =
            documentReferenceFromDataset(dataset).content[0].attachment;
        expect(attachment.size).toBe(10);
        expect(new Uint8Array(Buffer.from(attachment.data, "base64"))).toEqual(
            payload
        );
    });

    test("EncapsulatedDocumentLength trims the pad the writer added (finding 16)", () => {
        // 9 content bytes padded to 10 on write; (0042,0015) says 9.
        const padded = new Uint8Array([
            0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0x00
        ]);
        const dataset = buildPdfDataset({
            EncapsulatedDocument: toArrayBuffer(padded),
            EncapsulatedDocumentLength: 9
        });
        const attachment =
            documentReferenceFromDataset(dataset).content[0].attachment;
        expect(attachment.size).toBe(9);
        expect(new Uint8Array(Buffer.from(attachment.data, "base64"))).toEqual(
            padded.subarray(0, 9)
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

    test("toFhir still yields imagingStudy (and null documentReference) for images", async () => {
        const dataset = await loadNaturalizedFixture();
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
