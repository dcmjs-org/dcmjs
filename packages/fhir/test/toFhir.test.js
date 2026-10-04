// packages/fhir/test/toFhir.test.js
//
// @dcmjs-org/fhir — the FHIR sink. Parses the committed sample-dicom.dcm
// fixture with @dcmjs-org/parser, naturalizes it, and asserts the FHIR
// output against the fixture's known ground truth (MR study, patient
// "Fall 3", PatientID 11791306742903).
//
// The v2 original read test/sample-dicom.dcm through the dcmjs umbrella;
// here the fixture comes from packages/fixtures/dicom (same bytes, but
// its upstream provenance is still being traced) and the package-level
// suites parse through the event-stream reader. The facade half of the
// v2 "dcmjs.fhir umbrella namespace" tests (an ArrayBuffer straight to
// FHIR) landed with the event-stream slice as
// DicomEventStream.fromPart10(bytes).toFhir() — see
// test/eventStream/fhirPdfEventStream.test.js at the repo root. The
// namespace half returned with the step-7 wrapper: the final describe
// block below exercises dcmjs.fhir on the assembled umbrella surface.

import fs from "fs";
import path from "path";

import dcmjs from "../../../src/index.js";
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

    // Regression for review finding 17: a dataset with no SOPClassUID used
    // to fabricate the CT Image Storage UID (1.2.840.10008.5.1.4.1.1.2),
    // asserting an unknown instance is a CT image. FHIR R4B makes
    // instance.sopClass 1..1, so the instance is skipped with a warning
    // instead of emitted with invented identity.
    test("missing SOPClassUID skips the instance, never fabricates CT (finding 17)", () => {
        const study = imagingStudyFromDatasets([
            {
                StudyInstanceUID: "1.2.3",
                SeriesInstanceUID: "1.2.3.1",
                SOPInstanceUID: "1.2.3.4"
            }
        ]);
        const json = JSON.stringify(study);
        expect(json).not.toContain("1.2.840.10008.5.1.4.1.1.2");
        expect(study.numberOfInstances).toBe(0);
        expect(study.series[0].instance).toBeUndefined();
    });

    // Regression for review finding 18: a dataset with no SeriesInstanceUID
    // used to produce series.uid: null (invalid — ImagingStudy.series.uid is
    // 1..1 in R4B), and every such dataset merged under one "unknown" key.
    // Those datasets are now skipped with a warning, consistent with 17.
    test("missing SeriesInstanceUID skips the dataset, no null-uid merge (finding 18)", () => {
        const study = imagingStudyFromDatasets([
            {
                StudyInstanceUID: "1.2.3",
                SeriesInstanceUID: "1.2.3.1",
                SOPClassUID: "1.2.840.10008.5.1.4.1.1.4",
                SOPInstanceUID: "1.2.3.4"
            },
            // Two datasets from genuinely different series, both without
            // SeriesInstanceUID — these must not merge into one series.
            {
                StudyInstanceUID: "1.2.3",
                SOPClassUID: "1.2.840.10008.5.1.4.1.1.4",
                SOPInstanceUID: "1.2.3.5"
            },
            {
                StudyInstanceUID: "1.2.3",
                SOPClassUID: "1.2.840.10008.5.1.4.1.1.4",
                SOPInstanceUID: "1.2.3.6"
            }
        ]);
        expect(study.numberOfSeries).toBe(1);
        expect(study.series).toHaveLength(1);
        expect(study.series[0].uid).toBe("1.2.3.1");
        expect(study.series.every(entry => entry.uid !== null)).toBe(true);
        expect(study.numberOfInstances).toBe(1);
    });
});

// The v2 suite ends with a "dcmjs.fhir umbrella namespace" block
// (dcmjs.fhir.fromPart10 straight to FHIR, and the namespace re-exports).
// Deferred by PR #579 until the step-7 wrapper assembled the scoped
// packages; the wrapper exists now, so the two namespace tests are back,
// exercising the real dcmjs default export from the root src/index.js.
describe("dcmjs.fhir umbrella namespace", () => {
    test("fromPart10 maps an ArrayBuffer straight to FHIR", () => {
        const buffer = fs.readFileSync(FIXTURE);
        const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
        );

        const { patient, imagingStudy } = dcmjs.fhir.fromPart10(arrayBuffer);

        expect(patient.identifier[0].value).toBe("11791306742903");
        expect(imagingStudy.identifier[0].value).toBe(`urn:oid:${STUDY_UID}`);
    });

    test("namespace re-exports the sink API", () => {
        expect(typeof dcmjs.fhir.toFhir).toBe("function");
        expect(typeof dcmjs.fhir.toBundle).toBe("function");
        expect(typeof dcmjs.fhir.patientFromDataset).toBe("function");
        expect(typeof dcmjs.fhir.imagingStudyFromDatasets).toBe("function");
    });
});
