// test/encapsulatedPdf.test.js
//
// Encapsulated PDF (SOP Class 1.2.840.10008.5.1.4.1.1.104.1): wrap a PDF
// into a conformant naturalized dataset (encapsulatePdf) and pull the PDF
// back out of a parsed instance (extractEncapsulatedPdf). Round-trips
// through datasetToBuffer -> DicomMessage.readFile, including the writer's
// odd-length OB NUL padding.

import fs from "fs";
import dcmjs from "../src/index.js";
import { validationLog } from "../src/log.js";

// Ignore validation chatter
validationLog.setLevel(5);

const { DicomMessage, DicomMetaDictionary, datasetToBuffer } = dcmjs.data;
const { encapsulatePdf, extractEncapsulatedPdf } = dcmjs.encapsulated;

const ENCAPSULATED_PDF_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.104.1";

// Minimal valid PDF, deliberately ODD length (199 bytes) so the OB
// even-padding path is exercised on write.
const PDF_STRING =
    "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
    "trailer<</Size 4/Root 1 0 R>>\n" +
    "%%EOF";
const PDF_BYTES = new TextEncoder().encode(PDF_STRING);

function bytesToString(bytes) {
    return String.fromCharCode(...bytes);
}

it("fixture PDF is odd-length", () => {
    expect(PDF_BYTES.byteLength % 2).toEqual(1);
    expect(bytesToString(PDF_BYTES.slice(0, 5))).toEqual("%PDF-");
});

it("exports encapsulatePdf and extractEncapsulatedPdf", () => {
    expect(typeof encapsulatePdf).toEqual("function");
    expect(typeof extractEncapsulatedPdf).toEqual("function");
});

it("builds a conformant Encapsulated PDF dataset with defaults", () => {
    const dataset = encapsulatePdf(PDF_BYTES);

    expect(dataset.SOPClassUID).toEqual(ENCAPSULATED_PDF_SOP_CLASS_UID);
    expect(dataset.Modality).toEqual("DOC");
    expect(dataset.MIMETypeOfEncapsulatedDocument).toEqual("application/pdf");
    expect(dataset.ConversionType).toEqual("WSD");
    expect(dataset.BurnedInAnnotation).toEqual("YES");
    expect(dataset.SpecificCharacterSet).toEqual("ISO_IR 192");
    expect(dataset.Manufacturer).toEqual("dcmjs");
    expect(dataset.SeriesNumber).toEqual(1);
    expect(dataset.InstanceNumber).toEqual(1);

    // Minted UIDs (dcmjs 2.25.x style)
    expect(dataset.SOPInstanceUID).toMatch(/^2\.25\./);
    expect(dataset.StudyInstanceUID).toMatch(/^2\.25\./);
    expect(dataset.SeriesInstanceUID).toMatch(/^2\.25\./);

    // Type 2 attributes present (may be empty)
    expect(dataset).toHaveProperty("PatientName");
    expect(dataset).toHaveProperty("PatientID");
    expect(dataset).toHaveProperty("StudyID");
    expect(dataset).toHaveProperty("AccessionNumber");
    expect(dataset).toHaveProperty("ReferringPhysicianName");
    expect(dataset).toHaveProperty("DocumentTitle");

    // Payload carried as an exact ArrayBuffer
    expect(dataset.EncapsulatedDocument).toBeInstanceOf(ArrayBuffer);
    expect(dataset.EncapsulatedDocument.byteLength).toEqual(
        PDF_BYTES.byteLength
    );

    // Meta declares Explicit VR Little Endian; VR map pins OB
    expect(dataset._meta.TransferSyntaxUID.Value[0]).toEqual(
        "1.2.840.10008.1.2.1"
    );
    expect(dataset._vrMap.EncapsulatedDocument).toEqual("OB");
});

it("honors caller options including attachment to an existing study", () => {
    const dataset = encapsulatePdf(PDF_BYTES, {
        PatientName: "Doe^Jane",
        PatientID: "MRN-42",
        DocumentTitle: "Discharge Summary",
        StudyInstanceUID: "1.2.3.4.5",
        SeriesInstanceUID: "1.2.3.4.5.6",
        SeriesDescription: "External reports"
    });

    expect(dataset.PatientName).toEqual("Doe^Jane");
    expect(dataset.PatientID).toEqual("MRN-42");
    expect(dataset.DocumentTitle).toEqual("Discharge Summary");
    expect(dataset.StudyInstanceUID).toEqual("1.2.3.4.5");
    expect(dataset.SeriesInstanceUID).toEqual("1.2.3.4.5.6");
    expect(dataset.SeriesDescription).toEqual("External reports");
});

it("rejects bytes that are not a PDF", () => {
    const notPdf = new TextEncoder().encode("hello world, no magic here");
    expect(() => encapsulatePdf(notPdf)).toThrow(/PDF/);
});

it("round-trips through Part 10 write and read", () => {
    const dataset = encapsulatePdf(PDF_BYTES, {
        PatientName: "Doe^Jane",
        DocumentTitle: "Discharge Summary"
    });

    const buffer = datasetToBuffer(dataset);
    const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );

    const dicomDict = DicomMessage.readFile(arrayBuffer);

    // Meta group: ELE + MediaStorage UIDs mirroring the instance
    const meta = DicomMetaDictionary.naturalizeDataset(dicomDict.meta);
    expect(meta.TransferSyntaxUID).toEqual("1.2.840.10008.1.2.1");
    expect(meta.MediaStorageSOPClassUID).toEqual(
        ENCAPSULATED_PDF_SOP_CLASS_UID
    );
    expect(meta.MediaStorageSOPInstanceUID).toEqual(dataset.SOPInstanceUID);

    const readBack = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
    expect(readBack.SOPClassUID).toEqual(ENCAPSULATED_PDF_SOP_CLASS_UID);
    expect(readBack.Modality).toEqual("DOC");
    expect(readBack.MIMETypeOfEncapsulatedDocument).toEqual("application/pdf");

    // Payload survives; the writer may add one NUL pad byte (odd OB)
    let payload = readBack.EncapsulatedDocument;
    if (Array.isArray(payload)) {
        payload = payload[0];
    }
    const payloadBytes = new Uint8Array(payload);
    expect(payloadBytes.byteLength).toBeGreaterThanOrEqual(
        PDF_BYTES.byteLength
    );
    expect(payloadBytes.byteLength).toBeLessThanOrEqual(
        PDF_BYTES.byteLength + 1
    );
    expect(bytesToString(payloadBytes.slice(0, 5))).toEqual("%PDF-");
    expect(bytesToString(payloadBytes.slice(0, PDF_BYTES.byteLength))).toEqual(
        PDF_STRING
    );
});

it("extractEncapsulatedPdf recovers the exact original bytes", () => {
    const dataset = encapsulatePdf(PDF_BYTES, {
        DocumentTitle: "Discharge Summary"
    });
    const buffer = datasetToBuffer(dataset);
    const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );
    const readBack = DicomMetaDictionary.naturalizeDataset(
        DicomMessage.readFile(arrayBuffer).dict
    );

    const extracted = extractEncapsulatedPdf(readBack);

    expect(extracted.mimeType).toEqual("application/pdf");
    expect(extracted.title).toEqual("Discharge Summary");
    expect(extracted.bytes).toBeInstanceOf(Uint8Array);
    // Trailing NUL pad trimmed: byte-identical to the source PDF
    expect(extracted.bytes.byteLength).toEqual(PDF_BYTES.byteLength);
    expect(bytesToString(extracted.bytes)).toEqual(PDF_STRING);
});

it("extractEncapsulatedPdf rejects a non-encapsulated instance", () => {
    const arrayBuffer = fs.readFileSync("test/sample-dicom.dcm").buffer;
    const readBack = DicomMetaDictionary.naturalizeDataset(
        DicomMessage.readFile(arrayBuffer).dict
    );
    expect(() => extractEncapsulatedPdf(readBack)).toThrow(/[Ee]ncapsulated/);
});
