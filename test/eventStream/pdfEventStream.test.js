// test/eventStream/pdfEventStream.test.js
//
// The PDF source-sink pair on DicomEventStream:
//   fromPdf — raw PDF bytes in
//   toPdf   — embedded PDF back out

import { DicomEventStream } from "../../src/eventStream.js";
import { validationLog } from "../../src/log.js";

validationLog.setLevel(5);

const PDF_STRING =
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Size 2>>\n%%EOF";
const PDF_BYTES = new TextEncoder().encode(PDF_STRING);

describe("fromPdf / toPdf", () => {
    test("fromPdf wraps and toPdf recovers the bytes", async () => {
        const events = DicomEventStream.fromPdf(PDF_BYTES, {
            overrides: {
                PatientName: "FOX^JANE",
                PatientID: "22446688",
                DocumentTitle: "Discharge Summary"
            }
        });
        const extracted = await events.toPdf();
        expect(new TextDecoder().decode(extracted.bytes)).toBe(PDF_STRING);
        expect(extracted.title).toBe("Discharge Summary");
    });

    test("toPdf on a non-PDF instance throws with the SOP class named", async () => {
        const events = DicomEventStream.fromImage({
            pixels: new Uint8Array(16),
            rows: 4,
            columns: 4
        });
        await expect(events.toPdf()).rejects.toThrow(/Encapsulated PDF/);
    });
});
