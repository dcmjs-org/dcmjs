// packages/encapsulated/test/encapsulate.test.js
//
// The generic Encapsulated Document builder and the decorator/inheritance
// contract: encapsulate() assembles the EncapsulatedDocument envelope from
// baseDicom + inherited context + overrides; encapsulatePdf() is a thin
// decorator over it. Round-trips through the event-stream engine, same
// pipeline as encapsulatedPdf.test.js.

import { DicomMetaDictionary, validationLog } from "@dcmjs-org/core";
import {
    fromDataSet,
    fromPart10,
    NaturalizedListener
} from "../../parser/src/index.js";
import { Part10Writer } from "../../generator/src/index.js";
import {
    encapsulate,
    encapsulatePdf,
    extractEncapsulatedPdf
} from "../src/index.js";

validationLog.setLevel(5);

const ENCAPSULATED_PDF_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.104.1";
const PDF_STRING = "%PDF-1.4\n% a tiny report\n%%EOF";
const PDF_BYTES = new TextEncoder().encode(PDF_STRING);

function bytesToString(bytes) {
    return String.fromCharCode(...bytes);
}

async function writePart10(dataset) {
    const meta = DicomMetaDictionary.denaturalizeDataset({
        MediaStorageSOPClassUID: dataset.SOPClassUID,
        MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
        TransferSyntaxUID: dataset._meta.TransferSyntaxUID.Value[0]
    });
    const dict = DicomMetaDictionary.denaturalizeDataset(dataset);
    const writer = new Part10Writer();
    await fromDataSet({ meta, dict }, writer);
    return writer.write();
}

async function readNaturalized(arrayBuffer) {
    const listener = new NaturalizedListener();
    await fromPart10(arrayBuffer, listener);
    return listener;
}

const sourceInstance = {
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.4",
    SOPInstanceUID: "1.2.3.4.5.6.7.100",
    StudyInstanceUID: "1.2.3.4.5",
    SeriesInstanceUID: "1.2.3.4.5.9",
    Modality: "MR",
    PatientName: "Doe^Jane",
    PatientID: "MRN-42",
    StudyID: "ST-7",
    SeriesDescription: "AX T1"
};

describe("encapsulate — the generic builder", () => {
    const base = {
        SpecificCharacterSet: "ISO_IR 192",
        SOPClassUID: "1.2.840.10008.5.1.4.1.1.104.2", // pretend: CDA
        Modality: "DOC",
        _meta: { TransferSyntaxUID: { Value: ["1.2.840.10008.1.2.1"] } },
        _vrMap: { EncapsulatedDocument: "OB" }
    };

    it("assembles the EncapsulatedDocument module from bytes + base + mime", () => {
        const bytes = new TextEncoder().encode("<ClinicalDocument/>\n");
        const ds = encapsulate(bytes, {
            baseDicom: base,
            mimeType: "text/xml"
        });

        expect(ds.SOPClassUID).toBe("1.2.840.10008.5.1.4.1.1.104.2");
        expect(ds.MIMETypeOfEncapsulatedDocument).toBe("text/xml");
        expect(ds.EncapsulatedDocument).toBeInstanceOf(ArrayBuffer);
        expect(ds.EncapsulatedDocumentLength).toBe(bytes.byteLength);
        expect(ds._vrMap.EncapsulatedDocument).toBe("OB");
        expect(ds._meta.TransferSyntaxUID.Value[0]).toBe("1.2.840.10008.1.2.1");
        // Minted identity.
        expect(ds.SOPInstanceUID).toMatch(/^2\.25\./);
        expect(ds.SeriesInstanceUID).toMatch(/^2\.25\./);
    });

    it("precedence is defaults < baseDicom < inherited < overrides", () => {
        const ds = encapsulate(PDF_BYTES, {
            baseDicom: base,
            mimeType: "application/pdf",
            instance: sourceInstance,
            dataLevel: "study",
            PatientID: "OVERRIDE"
        });
        // inherited from source
        expect(ds.PatientName).toBe("Doe^Jane");
        expect(ds.StudyInstanceUID).toBe("1.2.3.4.5");
        // explicit override wins
        expect(ds.PatientID).toBe("OVERRIDE");
    });
});

describe("identity guard", () => {
    it("never inherits document identity, even at series level", () => {
        const ds = encapsulatePdf(PDF_BYTES, {
            instance: sourceInstance,
            dataLevel: "series"
        });
        // Series-level context flows in...
        expect(ds.SeriesDescription).toBe("AX T1");
        // ...but identity is protected.
        expect(ds.SOPClassUID).toBe(ENCAPSULATED_PDF_SOP_CLASS_UID);
        expect(ds.Modality).toBe("DOC");
        expect(ds.SeriesInstanceUID).not.toBe("1.2.3.4.5.9");
        expect(ds.SeriesInstanceUID).toMatch(/^2\.25\./);
        expect(ds.SOPInstanceUID).not.toBe("1.2.3.4.5.6.7.100");
    });
});

describe("encapsulatePdf decorator", () => {
    it("sourceInstance alias equals instance + dataLevel:'study'", () => {
        const viaAlias = encapsulatePdf(PDF_BYTES, { sourceInstance });
        const viaInstance = encapsulatePdf(PDF_BYTES, {
            instance: sourceInstance,
            dataLevel: "study"
        });
        for (const key of [
            "PatientName",
            "PatientID",
            "StudyInstanceUID",
            "StudyID",
            "SOPClassUID",
            "Modality"
        ]) {
            expect(viaAlias[key]).toEqual(viaInstance[key]);
        }
        // Both mint a fresh series, not the source's.
        expect(viaAlias.SeriesInstanceUID).not.toBe("1.2.3.4.5.9");
        expect(viaInstance.SeriesInstanceUID).not.toBe("1.2.3.4.5.9");
    });

    it("round-trips an inherited-context PDF through Part 10", async () => {
        const ds = encapsulatePdf(PDF_BYTES, {
            instance: sourceInstance,
            dataLevel: "study",
            DocumentTitle: "Discharge Summary"
        });
        const { result } = await readNaturalized(await writePart10(ds));

        expect(result.StudyInstanceUID).toBe("1.2.3.4.5");
        expect(result.SOPClassUID).toBe(ENCAPSULATED_PDF_SOP_CLASS_UID);
        const extracted = extractEncapsulatedPdf(result);
        expect(bytesToString(extracted.bytes)).toBe(PDF_STRING);
        expect(extracted.title).toBe("Discharge Summary");
    });
});
