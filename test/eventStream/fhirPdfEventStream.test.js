// test/eventStream/fhirPdfEventStream.test.js
//
// The FHIR/PDF source-sink symmetry on DicomEventStream:
//   fromFhir  — content-carrying resources (DocumentReference/Media) in
//   fromPdf   — raw PDF bytes in
//   toFhir    — instance out as FHIR resources
//   toPdf     — embedded PDF back out
// Test identity: JANE FOX. The key-image case (embedded JPEG carried
// verbatim as encapsulated PixelData) is the load-bearing one.
//
// Ported from v2's test/eventStream/fhirPdfEventStream.test.js with two
// deltas: the parseJpegInfo block lives with its code in
// packages/video/test/jpegInfo.test.js (a superset — not duplicated
// here), and fromFhir is now LAZY (finding 14), so the corrective-error
// tests assert rejection from the sink rather than a throw from the
// factory.

import fs from "fs";
import path from "path";

import dcmjs from "../../src/index.js";
import { validationLog } from "../../src/log.js";

validationLog.setLevel(5);

const { DicomEventStream } = dcmjs.eventStream;
const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const PDF_STRING =
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Size 2>>\n%%EOF";
const PDF_BYTES = new TextEncoder().encode(PDF_STRING);

// Minimal baseline JPEG: SOI, SOF0 (8-bit, 2 rows x 3 cols, 1 component),
// EOI. Enough for the header parser; the bytes travel verbatim.
const JPEG_BYTES = new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xc0,
    0x00,
    0x0b, // SOF0, length 11
    0x08, // precision 8
    0x00,
    0x02, // rows 2
    0x00,
    0x03, // columns 3
    0x01, // 1 component
    0x01,
    0x11,
    0x00, // component spec
    0xff,
    0xd9 // EOI
]);

function toBase64(bytes) {
    return Buffer.from(bytes).toString("base64");
}

const JANE_FOX = {
    resourceType: "Patient",
    identifier: [{ type: { coding: [{ code: "MR" }] }, value: "22446688" }],
    name: [{ use: "official", family: "FOX", given: ["JANE"] }],
    gender: "female",
    birthDate: "1980-04-15"
};

function documentReference(overrides = {}) {
    return {
        resourceType: "DocumentReference",
        status: "current",
        description: "Signed consent",
        content: [
            {
                attachment: {
                    contentType: "application/pdf",
                    data: toBase64(PDF_BYTES)
                }
            }
        ],
        ...overrides
    };
}

function keyImageMedia() {
    return {
        resourceType: "Media",
        status: "completed",
        content: {
            contentType: "image/jpeg",
            data: toBase64(JPEG_BYTES)
        }
    };
}

function readBack(arrayBuffer) {
    const dicomDict = DicomMessage.readFile(arrayBuffer);
    return {
        meta: DicomMetaDictionary.naturalizeDataset(dicomDict.meta),
        dataset: DicomMetaDictionary.naturalizeDataset(dicomDict.dict)
    };
}

/** Collect unhandled rejections across a scope; restore handlers after. */
async function withUnhandledRejectionCapture(scope) {
    const captured = [];
    const onUnhandled = reason => captured.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
        await scope();
        // Unhandled rejections surface on later macrotask ticks; give the
        // event loop a few turns so a leak has every chance to fire.
        for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setImmediate(resolve));
        }
    } finally {
        process.removeListener("unhandledRejection", onUnhandled);
    }
    return captured;
}

describe("fromFhir", () => {
    // Finding 14, the fromFhir shape: the naive port builds the dataset at
    // factory time, so garbage input throws from the factory before anyone
    // has called .process(). The contract is the same as fromVideo's: the
    // factory never throws or leaks a rejection; the error surfaces from
    // the sink call.
    test("finding 14: fromFhir(garbage) surfaces the error from the sink, not the factory", async () => {
        const captured = await withUnhandledRejectionCapture(async () => {
            const events = DicomEventStream.fromFhir({ not: "a resource" });
            // An unrelated await — the factory must stay inert until a
            // sink actually drives the stream.
            await new Promise(resolve => setTimeout(resolve, 20));
            await expect(events.toPart10()).rejects.toThrow(
                /expected a FHIR resource object/
            );
        });

        expect(captured).toEqual([]);
    });

    test("DocumentReference with embedded PDF → Encapsulated PDF instance", async () => {
        const events = DicomEventStream.fromFhir(documentReference(), {
            patient: JANE_FOX
        });
        const { dataset } = readBack(await events.toPart10());

        expect(dataset.SOPClassUID).toBe("1.2.840.10008.5.1.4.1.1.104.1");
        expect(String(dataset.PatientName)).toBe("FOX^JANE");
        expect(dataset.PatientID).toBe("22446688");
        expect(dataset.DocumentTitle).toBe("Signed consent");

        // and the PDF comes back out through the sink
        const extracted = await events.toPdf();
        expect(new TextDecoder().decode(extracted.bytes)).toBe(PDF_STRING);
    });

    test("Media with embedded JPEG → key image with verbatim pixel bytes", async () => {
        const events = DicomEventStream.fromFhir(keyImageMedia(), {
            patient: JANE_FOX
        });
        const { meta, dataset } = readBack(await events.toPart10());

        expect(meta.TransferSyntaxUID).toBe("1.2.840.10008.1.2.4.50");
        expect(dataset.Rows).toBe(2);
        expect(dataset.Columns).toBe(3);
        expect(dataset.PhotometricInterpretation).toBe("MONOCHROME2");
        expect(dataset.PatientID).toBe("22446688");

        let payload = dataset.PixelData;
        if (Array.isArray(payload)) {
            payload = payload[0];
        }
        const bytes =
            payload instanceof ArrayBuffer
                ? new Uint8Array(payload)
                : new Uint8Array(
                      payload.buffer,
                      payload.byteOffset,
                      payload.byteLength
                  );
        // fragments are even-padded on write; our fixture is 17 bytes,
        // so tolerate the single trailing NUL
        expect(Array.from(bytes.subarray(0, JPEG_BYTES.length))).toEqual(
            Array.from(JPEG_BYTES)
        );
        expect(bytes.length - JPEG_BYTES.length).toBeLessThanOrEqual(1);
    });

    test("fromFhir streams are re-runnable with stable identity", async () => {
        const events = DicomEventStream.fromFhir(documentReference(), {
            patient: JANE_FOX
        });
        const naturalized = await events.toNaturalized();
        const { dataset } = readBack(await events.toPart10());
        expect(dataset.SOPInstanceUID).toBe(naturalized.SOPInstanceUID);
    });

    test("Bundle: content resource plus Patient are both picked up", async () => {
        const bundle = {
            resourceType: "Bundle",
            type: "collection",
            entry: [{ resource: JANE_FOX }, { resource: documentReference() }]
        };
        const { dataset } = readBack(
            await DicomEventStream.fromFhir(bundle).toPart10()
        );
        expect(dataset.PatientID).toBe("22446688");
        expect(dataset.SOPClassUID).toBe("1.2.840.10008.5.1.4.1.1.104.1");
    });

    test("Patient alone is rejected with guidance", async () => {
        await expect(
            DicomEventStream.fromFhir(JANE_FOX).toPart10()
        ).rejects.toThrow(/carries context, not content/);
    });

    test("url-only attachment is rejected with guidance", async () => {
        const resource = documentReference();
        resource.content[0].attachment = {
            contentType: "application/pdf",
            url: "https://server/Binary/123"
        };
        await expect(
            DicomEventStream.fromFhir(resource).toPart10()
        ).rejects.toThrow(/fetch the bytes first/);
    });

    test("unsupported content type points at fromImage", async () => {
        const resource = documentReference();
        resource.content[0].attachment = {
            contentType: "image/png",
            data: toBase64(new Uint8Array([1, 2, 3]))
        };
        await expect(
            DicomEventStream.fromFhir(resource).toPart10()
        ).rejects.toThrow(
            /decode the pixels and use DicomEventStream.fromImage/
        );
    });

    test("Bundle with several content resources demands an explicit choice", async () => {
        const bundle = {
            resourceType: "Bundle",
            entry: [
                { resource: documentReference({ id: "a" }) },
                { resource: documentReference({ id: "b" }) }
            ]
        };
        await expect(
            DicomEventStream.fromFhir(bundle).toPart10()
        ).rejects.toThrow(/pass the one you want directly/);
    });
});

describe("fromPdf / toPdf / toFhir", () => {
    test("fromPdf wraps and toPdf recovers the bytes", async () => {
        const events = DicomEventStream.fromPdf(PDF_BYTES, {
            PatientName: "FOX^JANE",
            PatientID: "22446688",
            DocumentTitle: "Discharge Summary"
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

    test("toFhir maps an image instance to Patient + ImagingStudy", async () => {
        const events = DicomEventStream.fromImage(
            { pixels: new Uint8Array(16), rows: 4, columns: 4 },
            {
                PatientName: "FOX^JANE",
                PatientID: "22446688",
                Modality: "MR"
            }
        );
        const {
            patient,
            imagingStudy,
            documentReference: doc
        } = await events.toFhir();
        expect(patient.identifier[0].value).toBe("22446688");
        expect(imagingStudy.resourceType).toBe("ImagingStudy");
        expect(imagingStudy.numberOfInstances).toBe(1);
        expect(doc).toBeNull();
    });

    test("toFhir on a PDF instance yields a DocumentReference", async () => {
        const events = DicomEventStream.fromPdf(PDF_BYTES, {
            PatientID: "22446688"
        });
        const { imagingStudy, documentReference: doc } = await events.toFhir();
        expect(doc.resourceType).toBe("DocumentReference");
        expect(imagingStudy).toBeNull();
    });

    // The facade form of v2's "dcmjs.fhir umbrella namespace / fromPart10
    // maps an ArrayBuffer straight to FHIR" test (deferred by PR #579):
    // the composition now lives on the event stream —
    // fromPart10(bytes).toFhir(). The dcmjs.fhir namespace itself waits
    // for the step-7 wrapper package.
    test("fromPart10 → toFhir maps a .dcm ArrayBuffer straight to FHIR", async () => {
        const buffer = fs.readFileSync(
            path.join(
                __dirname,
                "..",
                "..",
                "packages",
                "fixtures",
                "dicom",
                "sample-dicom.dcm"
            )
        );
        const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
        );

        const { patient, imagingStudy } = await DicomEventStream.fromPart10(
            arrayBuffer
        ).toFhir();

        expect(patient.identifier[0].value).toBe("11791306742903");
        expect(imagingStudy.identifier[0].value).toBe(
            "urn:oid:1.2.276.0.50.192168001092.11156604.14547392.4"
        );
    });
});
