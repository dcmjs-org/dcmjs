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
// @dcmjs-org/legacy.

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

    test("dicomDateTimeToIso writes the time only with a timezone", () => {
        expect(dicomDateTimeToIso("20010101")).toBe("2001-01-01");
        expect(dicomDateTimeToIso("20010101", "102231")).toBe("2001-01-01");
        expect(dicomDateTimeToIso("20010101", "102231", "+0130")).toBe(
            "2001-01-01T10:22:31+01:30"
        );
        expect(dicomDateTimeToIso(null)).toBeNull();
        // Legacy ACR-NEMA forms, and values that are not a date
        expect(dicomDateTimeToIso("1980.05.17", "10:22:31", "+0100")).toBe(
            "1980-05-17T10:22:31+01:00"
        );
        expect(dicomDateTimeToIso("1980-5-17")).toBeNull();
        expect(dicomDateTimeToIso("20010101", "10h22", "+0100")).toBe(
            "2001-01-01"
        );
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
        // No deployment-specific fields ever, and no sex extension that
        // DICOM does not record (FHIR-USR-3)
        expect(patient.id).toBeUndefined();
        expect(patient.meta).toBeUndefined();
        expect(patient.extension).toBeUndefined();
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
        // The fixture has no TimezoneOffsetFromUTC, so only the date.
        expect(imagingStudy.started).toBe("2001-01-01");

        const series = imagingStudy.series[0];
        expect(series.modality.code).toBe("MR");
        expect(series.modality.display).toBe("Magnetic Resonance");
        expect(series.number).toBe(2101);
        expect(series.instance[0].number).toBe(10);
        expect(series.instance[0].sopClass.system).toBe("urn:ietf:rfc:3986");
        expect(series.instance[0].sopClass.code).toMatch(/^urn:oid:/);
    });

    test("without options.subject, the ImagingStudy references the returned patient", () => {
        const { imagingStudy } = toFhir(dataset);
        expect(imagingStudy.subject).toEqual({ reference: "./patient" });
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

    test("imagingStudyFromDatasets skips a dataset of another study", () => {
        const other = {
            ...dataset,
            StudyInstanceUID: "9.9.9",
            SeriesInstanceUID: "9.9.9.1",
            SOPInstanceUID: "9.9.9.1.1"
        };
        const study = imagingStudyFromDatasets([dataset, other]);
        expect(study.identifier[0].value).toBe(`urn:oid:${STUDY_UID}`);
        expect(study.numberOfSeries).toBe(1);
        expect(study.numberOfInstances).toBe(1);
    });

    test("toBundle emits one Patient and one aggregated ImagingStudy", () => {
        const bundle = toBundle([dataset, dataset]);

        expect(bundle.resourceType).toBe("Bundle");
        expect(bundle.type).toBe("collection");
        expect(bundle.total).toBe(2);

        const types = bundle.entry.map(entry => entry.resource.resourceType);
        expect(types).toEqual(["Patient", "ImagingStudy"]);
        expect(bundle.entry[1].resource.numberOfInstances).toBe(2);
        // Relative fullUrls link the ImagingStudy to the Patient entry.
        expect(bundle.entry.map(entry => entry.fullUrl)).toEqual([
            "./entry/0",
            "./entry/1"
        ]);
        expect(bundle.entry[1].resource.subject).toEqual({
            reference: "./entry/0"
        });
    });

    test("series and instances hold only valid FHIR values", () => {
        const base = {
            StudyInstanceUID: "1.2.3",
            SOPClassUID: "1.2.840.10008.5.1.4.1.1.4"
        };
        const study = imagingStudyFromDatasets([
            {
                ...base,
                SeriesInstanceUID: "1.2.3.1",
                SOPInstanceUID: "1.2.3.1.1",
                Modality: "MR",
                SeriesNumber: -1,
                InstanceNumber: 2.5,
                BodyPartExamined: "CHEST",
                Laterality: "L"
            },
            // No Modality: series.modality is 1..1, so the dataset is skipped.
            {
                ...base,
                SeriesInstanceUID: "1.2.3.2",
                SOPInstanceUID: "1.2.3.2.1"
            }
        ]);
        expect(study.numberOfSeries).toBe(1);
        const [series] = study.series;
        expect(series.number).toBeUndefined();
        expect(series.instance[0].number).toBeUndefined();
        expect(series.bodySite).toEqual({ display: "CHEST" });
        expect(series.laterality).toEqual({
            system: "http://snomed.info/sct",
            code: "7771000",
            display: "Left"
        });
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
                SOPInstanceUID: "1.2.3.4",
                Modality: "OT"
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
                SOPInstanceUID: "1.2.3.4",
                Modality: "MR"
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
// The dcmjs.fhir namespace of v2 is this package itself: the wrapper
// @dcmjs-org/dcmjs does not re-export it or depend on it, because the
// package is preliminary. The tests above already parse bytes to FHIR.
