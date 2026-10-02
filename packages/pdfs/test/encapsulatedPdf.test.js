// packages/pdfs/test/encapsulatedPdf.test.js
//
// Encapsulated PDF (SOP Class 1.2.840.10008.5.1.4.1.1.104.1): wrap a PDF
// into a conformant naturalized dataset (encapsulatePdf) and pull the PDF
// back out of a parsed instance (extractEncapsulatedPdf). Round-trips
// through the event-stream engine — denaturalize -> fromDataSet ->
// Part10Writer -> fromPart10 -> NaturalizedListener — including the
// writer's odd-length OB NUL padding. No @dcmjs-org/legacy import: the
// v2 suite's datasetToBuffer/DicomMessage.readFile pair is replaced by
// the parser/generator pipeline.

import { DicomMetaDictionary, validationLog } from "@dcmjs-org/core";
import {
    fromDataSet,
    fromPart10,
    NaturalizedListener
} from "../../parser/src/index.js";
import { Part10Writer } from "../../generator/src/index.js";
import { encapsulatePdf, extractEncapsulatedPdf } from "../src/index.js";

// Ignore validation chatter
validationLog.setLevel(5);

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

/** Naturalized dataset -> Part 10 bytes, minting the file meta group the
 *  way the legacy datasetToDict does, but through the event-stream writer. */
async function writePart10(dataset) {
    const transferSyntaxUID =
        (dataset._meta &&
            dataset._meta.TransferSyntaxUID &&
            dataset._meta.TransferSyntaxUID.Value[0]) ||
        "1.2.840.10008.1.2.1";
    const meta = DicomMetaDictionary.denaturalizeDataset({
        MediaStorageSOPClassUID: dataset.SOPClassUID,
        MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
        TransferSyntaxUID: transferSyntaxUID
    });
    const dict = DicomMetaDictionary.denaturalizeDataset(dataset);
    const writer = new Part10Writer();
    await fromDataSet({ meta, dict }, writer);
    return writer.write();
}

/** Part 10 bytes -> { result, meta } naturalized via the streaming reader. */
async function readNaturalized(arrayBuffer) {
    const listener = new NaturalizedListener();
    await fromPart10(arrayBuffer, listener);
    return listener;
}

/** Unwrap the naturalized EncapsulatedDocument ({ InlineBinary } wrapper,
 *  Value array, ArrayBuffer, or view) into a Uint8Array, without the
 *  pad-handling that extractEncapsulatedPdf itself applies. */
function rawPayloadBytes(readBack) {
    let payload = readBack.EncapsulatedDocument;
    if (Array.isArray(payload)) {
        payload = payload[0];
    }
    if (
        payload &&
        typeof payload === "object" &&
        !(payload instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(payload) &&
        payload.InlineBinary !== undefined
    ) {
        payload = Array.isArray(payload.InlineBinary)
            ? payload.InlineBinary[0]
            : payload.InlineBinary;
    }
    return ArrayBuffer.isView(payload)
        ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
        : new Uint8Array(payload);
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

it("round-trips through Part 10 write and read", async () => {
    const dataset = encapsulatePdf(PDF_BYTES, {
        PatientName: "Doe^Jane",
        DocumentTitle: "Discharge Summary"
    });

    const listener = await readNaturalized(await writePart10(dataset));

    // Meta group: ELE + MediaStorage UIDs mirroring the instance
    expect(listener.meta.TransferSyntaxUID).toEqual("1.2.840.10008.1.2.1");
    expect(listener.meta.MediaStorageSOPClassUID).toEqual(
        ENCAPSULATED_PDF_SOP_CLASS_UID
    );
    expect(listener.meta.MediaStorageSOPInstanceUID).toEqual(
        dataset.SOPInstanceUID
    );

    const readBack = listener.result;
    expect(readBack.SOPClassUID).toEqual(ENCAPSULATED_PDF_SOP_CLASS_UID);
    expect(readBack.Modality).toEqual("DOC");
    expect(readBack.MIMETypeOfEncapsulatedDocument).toEqual("application/pdf");

    // Payload survives; the writer may add one NUL pad byte (odd OB)
    const payloadBytes = rawPayloadBytes(readBack);
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

it("extractEncapsulatedPdf recovers the exact original bytes", async () => {
    const dataset = encapsulatePdf(PDF_BYTES, {
        DocumentTitle: "Discharge Summary"
    });
    const listener = await readNaturalized(await writePart10(dataset));

    const extracted = extractEncapsulatedPdf(listener.result);

    expect(extracted.mimeType).toEqual("application/pdf");
    expect(extracted.title).toEqual("Discharge Summary");
    expect(extracted.bytes).toBeInstanceOf(Uint8Array);
    // Trailing NUL pad trimmed: byte-identical to the source PDF
    expect(extracted.bytes.byteLength).toEqual(PDF_BYTES.byteLength);
    expect(bytesToString(extracted.bytes)).toEqual(PDF_STRING);
});

it("extractEncapsulatedPdf rejects a non-encapsulated instance", async () => {
    // Synthetic MR instance round-tripped through the same pipeline — the
    // v2 suite read test/sample-dicom.dcm here; a generated dataset proves
    // the same thing without the fixture dependency.
    const mrDataset = {
        SOPClassUID: "1.2.840.10008.5.1.4.1.1.4",
        SOPInstanceUID: DicomMetaDictionary.uid(),
        StudyInstanceUID: DicomMetaDictionary.uid(),
        SeriesInstanceUID: DicomMetaDictionary.uid(),
        Modality: "MR",
        PatientName: "Doe^Jane",
        PatientID: "MRN-42",
        _meta: {
            TransferSyntaxUID: {
                Value: ["1.2.840.10008.1.2.1"]
            }
        },
        _vrMap: {}
    };
    const listener = await readNaturalized(await writePart10(mrDataset));
    expect(listener.result.Modality).toEqual("MR");
    expect(() => extractEncapsulatedPdf(listener.result)).toThrow(
        /[Ee]ncapsulated/
    );
});
