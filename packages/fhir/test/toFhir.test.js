// packages/fhir/test/toFhir.test.js
//
// @dcmjs-org/fhir — the FHIR sink. Parses the committed sample-dicom.dcm
// fixture with @dcmjs-org/parser, naturalizes it, and asserts the FHIR
// output against the fixture's known ground truth (MR study, patient
// "Fall 3", PatientID 11791306742903).
//
// The v2 original read test/sample-dicom.dcm through the dcmjs umbrella;
// here the fixture comes from packages/fixtures/dicom (same bytes, but
// its upstream provenance is still being traced) and the parse goes
// through the event-stream reader so the package tests stay off
// @dcmjs-org/legacy. The v2 "dcmjs.fhir umbrella namespace" tests
// (fromPart10 facade) are deferred with the event-stream slice.

import fs from "fs";
import path from "path";

import { fromPart10, NaturalizedListener } from "@dcmjs-org/parser";
import {
    toFhir,
    toBundle,
    patientFromDataset,
    imagingStudyFromDatasets,
    parsePersonName,
    dicomDateTimeToIso,
    sexToGender
} from "../src/index.js";

const FIXTURE = path.join(
    __dirname,
    "..",
    "..",
    "fixtures",
    "dicom",
    "sample-dicom.dcm"
);
const STUDY_UID = "1.2.276.0.50.192168001092.11156604.14547392.4";

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

describe("@dcmjs-org/fhir helpers", () => {
    test("parsePersonName handles naturalized PN, raw strings, and empties", () => {
        expect(parsePersonName([{ Alphabetic: "Doe^John^Q^Dr^Jr" }])).toEqual({
            family: "Doe",
            given: "John",
            middle: "Q",
            prefix: "Dr",
            suffix: "Jr",
            text: "Doe John Q Dr Jr"
        });
        expect(parsePersonName("Fall 3")).toMatchObject({
            family: "Fall 3",
            text: "Fall 3"
        });
        expect(parsePersonName(null)).toBeNull();
        expect(parsePersonName([])).toBeNull();
    });

    test("dicomDateTimeToIso formats DA and DA+TM", () => {
        expect(dicomDateTimeToIso("20010101")).toBe("2001-01-01");
        expect(dicomDateTimeToIso("20010101", "102231")).toBe(
            "2001-01-01T10:22:31"
        );
        expect(dicomDateTimeToIso(null)).toBeNull();
    });

    test("sexToGender maps DICOM codes", () => {
        expect(sexToGender("M")).toBe("male");
        expect(sexToGender("F")).toBe("female");
        expect(sexToGender("O")).toBe("other");
        expect(sexToGender(undefined)).toBe("unknown");
    });
});

describe("@dcmjs-org/fhir sink", () => {
    let dataset;
    beforeAll(async () => {
        dataset = await loadNaturalizedFixture();
    });

    test("patientFromDataset builds a FHIR Patient from the patient module", () => {
        const patient = patientFromDataset(dataset);

        expect(patient.resourceType).toBe("Patient");
        expect(patient.identifier[0].value).toBe("11791306742903");
        expect(patient.identifier[0].type.coding[0].code).toBe("MR");
        expect(patient.name[0].family).toBe("Fall 3");
        expect(["male", "female", "other", "unknown"]).toContain(
            patient.gender
        );
        // No deployment-specific fields ever
        expect(patient.id).toBeUndefined();
        expect(patient.meta).toBeUndefined();
    });

    test("toFhir returns { patient, imagingStudy } with DICOM identity intact", () => {
        const { patient, imagingStudy } = toFhir(dataset);

        expect(patient.resourceType).toBe("Patient");
        expect(imagingStudy.resourceType).toBe("ImagingStudy");
        expect(imagingStudy.status).toBe("available");
        expect(imagingStudy.identifier[0]).toEqual({
            use: "official",
            system: "urn:dicom:uid",
            value: `urn:oid:${STUDY_UID}`
        });
        expect(imagingStudy.numberOfSeries).toBe(1);
        expect(imagingStudy.numberOfInstances).toBe(1);
        expect(imagingStudy.modality[0].code).toBe("MR");
        expect(imagingStudy.started).toMatch(/^2001-01-01T/);

        const series = imagingStudy.series[0];
        expect(series.modality.code).toBe("MR");
        expect(series.modality.display).toBe("Magnetic Resonance");
        expect(series.number).toBe(2101);
        expect(series.instance[0].number).toBe(10);
        expect(series.instance[0].sopClass.system).toBe("urn:ietf:rfc:3986");
        expect(series.instance[0].sopClass.code).toMatch(/^urn:oid:/);
    });

    test("options.subject passes through as ImagingStudy.subject", () => {
        const { imagingStudy } = toFhir(dataset, {
            subject: { reference: "Patient/abc", display: "Fall 3" }
        });
        expect(imagingStudy.subject).toEqual({
            reference: "Patient/abc",
            display: "Fall 3"
        });
    });

    test("imagingStudyFromDatasets aggregates multiple instances into one study", () => {
        const study = imagingStudyFromDatasets([dataset, dataset]);
        expect(study.numberOfSeries).toBe(1);
        expect(study.numberOfInstances).toBe(2);
        expect(study.series[0].instance).toHaveLength(2);
    });

    test("toBundle emits one Patient and one aggregated ImagingStudy", () => {
        const bundle = toBundle([dataset, dataset]);

        expect(bundle.resourceType).toBe("Bundle");
        expect(bundle.type).toBe("collection");
        expect(bundle.total).toBe(2);

        const types = bundle.entry.map(entry => entry.resource.resourceType);
        expect(types).toEqual(["Patient", "ImagingStudy"]);
        expect(bundle.entry[1].resource.numberOfInstances).toBe(2);
    });

    test("unsupported fhirVersion throws (strict-out)", () => {
        expect(() => toFhir(dataset, { fhirVersion: "R5" })).toThrow(
            /unsupported fhirVersion/
        );
        expect(() => toBundle([dataset], { fhirVersion: "STU3" })).toThrow(
            /unsupported fhirVersion/
        );
    });

    test("empty input degrades gracefully", () => {
        expect(patientFromDataset({})).toBeNull();
        expect(imagingStudyFromDatasets([])).toBeNull();
        const { patient, imagingStudy } = toFhir({});
        expect(patient).toBeNull();
        expect(imagingStudy).toBeNull();
    });
});

// The v2 suite ends with a "dcmjs.fhir umbrella namespace" block
// (dcmjs.fhir.fromPart10 straight to FHIR, and the namespace re-exports).
// Those two tests cover the facade integration, which is deferred to the
// event-stream slice after the pdfs/video/media waves — they return with
// fromFhir.js.
