// test/fhirNamespace.test.js
//
// The v2 "dcmjs.fhir umbrella namespace" tests, deferred by PR #579 until
// the step-7 wrapper assembled the scoped packages. They exercise the
// dcmjs default export from the root src/index.js, so they live at the
// repo root and the @dcmjs-org/fhir package tests stay off the wrapper.

import fs from "fs";
import path from "path";

import dcmjs from "../src/index.js";

const FIXTURE = path.join(
    __dirname,
    "..",
    "packages",
    "fixtures",
    "dicom",
    "sample-dicom.dcm"
);
const STUDY_UID = "1.2.276.0.50.192168001092.11156604.14547392.4";

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
