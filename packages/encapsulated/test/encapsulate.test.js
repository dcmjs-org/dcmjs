// packages/encapsulated/test/encapsulate.test.js
//
// The generic Encapsulated Document builder: base composition, the MIME type
// precedence, and an inherited-context round trip. The inheritance rules
// themselves are tested in packages/core.

import { validationLog, combineBases } from "@dcmjs-org/core";
import {
    encapsulate,
    encapsulatedBase,
    encapsulatedPdfBase,
    pdfBase,
    encapsulatePdf,
    extractEncapsulated,
    extractEncapsulatedPdf
} from "../src/index.js";
import {
    bytesToString,
    readNaturalized,
    writePart10
} from "./part10Helpers.js";

validationLog.setLevel(5);

const ENCAPSULATED_PDF_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.104.1";
const PDF_STRING = "%PDF-1.4\n% a tiny report\n%%EOF";
const PDF_BYTES = new TextEncoder().encode(PDF_STRING);

const cdaBase = {
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.104.2",
    Modality: "DOC",
    MIMETypeOfEncapsulatedDocument: "text/xml"
};

describe("encapsulate — the generic builder", () => {
    it("assembles the document from the base blocks and the bytes", () => {
        const bytes = new TextEncoder().encode("<ClinicalDocument/>\n");
        const ds = encapsulate(bytes, {
            baseDicom: [encapsulatedBase, cdaBase]
        });

        expect(ds.SOPClassUID).toBe("1.2.840.10008.5.1.4.1.1.104.2");
        expect(ds.MIMETypeOfEncapsulatedDocument).toBe("text/xml");
        expect(ds.ConversionType).toBe("WSD");
        expect(ds.EncapsulatedDocument).toBeInstanceOf(ArrayBuffer);
        expect(ds.EncapsulatedDocumentLength).toBe(bytes.byteLength);
        expect(ds._vrMap.EncapsulatedDocument).toBe("OB");
        expect(ds.SOPInstanceUID).toMatch(/^2\.25\./);
    });

    it("mimeType wins over the dataset value, which wins over the base", () => {
        const base = [encapsulatedBase, cdaBase];
        expect(
            encapsulate(PDF_BYTES, {
                baseDicom: base,
                overrides: { MIMETypeOfEncapsulatedDocument: "model/stl" }
            }).MIMETypeOfEncapsulatedDocument
        ).toBe("model/stl");
        expect(
            encapsulate(PDF_BYTES, {
                baseDicom: base,
                overrides: { MIMETypeOfEncapsulatedDocument: "model/stl" },
                mimeType: "text/xml; charset=utf-8"
            }).MIMETypeOfEncapsulatedDocument
        ).toBe("text/xml; charset=utf-8");
    });

    it("a base part can be replaced without changing the others", () => {
        const pdfa = { ...pdfBase, Manufacturer: "PDF/A tool" };
        const variant = combineBases(
            ...encapsulatedPdfBase.items.map(item =>
                item === pdfBase ? pdfa : item
            )
        );
        const ds = encapsulatePdf(PDF_BYTES, { baseDicom: variant });
        expect(ds.Manufacturer).toBe("PDF/A tool");
        expect(ds.SOPClassUID).toBe(ENCAPSULATED_PDF_SOP_CLASS_UID);
        expect(ds.ConversionType).toBe("WSD");
        expect(
            encapsulatePdf(PDF_BYTES, { baseDicom: undefined }).SOPClassUID
        ).toBe(ENCAPSULATED_PDF_SOP_CLASS_UID);
    });

    it("a new PDF replaces an older one in its series, with the older one as predecessor", async () => {
        const older = encapsulatePdf(PDF_BYTES, {
            overrides: { DocumentTitle: "v1" }
        });
        const newer = encapsulatePdf(PDF_BYTES, {
            instance: older,
            dataLevel: "series",
            predecessor: true,
            overrides: { DocumentTitle: "v2" }
        });
        expect(newer.SeriesInstanceUID).toBe(older.SeriesInstanceUID);
        expect(newer.SOPInstanceUID).not.toBe(older.SOPInstanceUID);

        const { result } = await readNaturalized(await writePart10(newer));
        const [study] = result.PredecessorDocumentsSequence;
        const [series] = study.ReferencedSeriesSequence;
        const [sop] = series.ReferencedSOPSequence;
        expect(study.StudyInstanceUID).toBe(older.StudyInstanceUID);
        expect(series.SeriesInstanceUID).toBe(older.SeriesInstanceUID);
        expect(sop.ReferencedSOPInstanceUID).toBe(older.SOPInstanceUID);
        expect(sop.ReferencedSOPClassUID).toBe(ENCAPSULATED_PDF_SOP_CLASS_UID);
    });

    it("round-trips an inherited-context PDF through Part 10", async () => {
        const source = {
            StudyInstanceUID: "1.2.3.4.5",
            PatientName: "Doe^Jane",
            Modality: "MR"
        };
        const ds = encapsulatePdf(PDF_BYTES, {
            instance: source,
            overrides: { DocumentTitle: "Discharge Summary" }
        });
        const { result } = await readNaturalized(await writePart10(ds));

        expect(result.StudyInstanceUID).toBe("1.2.3.4.5");
        expect(result.Modality).toBe("DOC");
        expect(result.SOPClassUID).toBe(ENCAPSULATED_PDF_SOP_CLASS_UID);
        const extracted = extractEncapsulatedPdf(result);
        expect(bytesToString(extracted.bytes)).toBe(PDF_STRING);
        expect(extracted.title).toBe("Discharge Summary");
    });
});

describe("extractEncapsulated — no EncapsulatedDocumentLength", () => {
    const evenWithTrailingZero = Uint8Array.from([0x50, 0x00]).buffer;

    it.each([
        ["text/xml", 1],
        [undefined, 1],
        ["model/stl", 2]
    ])(
        "MIME type %s keeps %i byte(s): only a text or PDF type loses the pad",
        (mimeType, expectedLength) => {
            const bytes = extractEncapsulated({
                MIMETypeOfEncapsulatedDocument: mimeType,
                EncapsulatedDocument: evenWithTrailingZero
            });
            expect(bytes.byteLength).toBe(expectedLength);
        }
    );
});
