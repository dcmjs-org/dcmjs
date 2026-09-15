// packages/fhir/test/patientToDataset.test.js
//
// The FHIR source direction: Patient resource → DICOM patient-module
// attributes. Test identity: JANE DOE (maiden) → JANE FOX (official).
// The genderToSex table is pinned exhaustively — administrative gender
// only, lossy by design, empty for unknown/absent.

import {
    patientToDataset,
    patientFromDataset,
    genderToSex,
    humanNameToPersonName,
    isoDateToDicom
} from "../src/index.js";

const JANE_FOX = {
    resourceType: "Patient",
    identifier: [
        {
            use: "usual",
            type: {
                coding: [
                    {
                        system: "http://terminology.hl7.org/CodeSystem/v2-0203",
                        code: "MR",
                        display: "Medical Record Number"
                    }
                ]
            },
            value: "22446688"
        }
    ],
    name: [
        { use: "official", family: "FOX", given: ["JANE"] },
        { use: "maiden", family: "DOE", given: ["JANE"] }
    ],
    gender: "female",
    birthDate: "1980-04-15"
};

describe("patientToDataset", () => {
    test("maps the full JANE FOX resource", () => {
        expect(patientToDataset(JANE_FOX)).toEqual({
            PatientName: "FOX^JANE",
            PatientID: "22446688",
            PatientBirthDate: "19800415",
            PatientSex: "F"
        });
    });

    test("official name wins over maiden regardless of order", () => {
        const maidenFirst = {
            ...JANE_FOX,
            name: [
                { use: "maiden", family: "DOE", given: ["JANE"] },
                { use: "official", family: "FOX", given: ["JANE"] }
            ]
        };
        expect(patientToDataset(maidenFirst).PatientName).toBe("FOX^JANE");
    });

    test("usual name is second preference; unadorned beats maiden", () => {
        const usual = {
            ...JANE_FOX,
            name: [
                { use: "maiden", family: "DOE", given: ["JANE"] },
                { use: "usual", family: "FOX", given: ["JANE"] }
            ]
        };
        expect(patientToDataset(usual).PatientName).toBe("FOX^JANE");

        const unadorned = {
            ...JANE_FOX,
            name: [
                { use: "maiden", family: "DOE", given: ["JANE"] },
                { family: "FOX", given: ["JANE"] }
            ]
        };
        expect(patientToDataset(unadorned).PatientName).toBe("FOX^JANE");
    });

    test("MR-typed identifier wins over other identifiers", () => {
        const multiId = {
            ...JANE_FOX,
            identifier: [
                { system: "urn:oid:2.16.840.1.113883.4.1", value: "999-99-9999" },
                JANE_FOX.identifier[0]
            ]
        };
        expect(patientToDataset(multiId).PatientID).toBe("22446688");
    });

    test("deterministic overwrite: absent fields are empty strings", () => {
        expect(patientToDataset({ resourceType: "Patient" })).toEqual({
            PatientName: "",
            PatientID: "",
            PatientBirthDate: "",
            PatientSex: ""
        });
    });

    test("partial FHIR birthDate maps to empty, never a fabricated day", () => {
        expect(
            patientToDataset({ ...JANE_FOX, birthDate: "1980" }).PatientBirthDate
        ).toBe("");
        expect(
            patientToDataset({ ...JANE_FOX, birthDate: "1980-04" })
                .PatientBirthDate
        ).toBe("");
    });

    test("non-Patient input throws with the resourceType named", () => {
        expect(() => patientToDataset({ resourceType: "Observation" })).toThrow(
            /expects a FHIR Patient.*Observation/
        );
        expect(() => patientToDataset(null)).toThrow(/expects a FHIR Patient/);
    });
});

describe("genderToSex — the full table", () => {
    test.each([
        ["male", "M"],
        ["female", "F"],
        ["other", "O"],
        ["unknown", ""],
        ["", ""],
        [null, ""],
        [undefined, ""],
        ["Male", "M"], // case-insensitive
        ["FEMALE", "F"],
        ["Unknown", ""],
        ["nonbinary", "O"], // unrecognized non-empty → O, never a guess
        ["x", "O"]
    ])("%p → %p", (gender, expected) => {
        expect(genderToSex(gender)).toBe(expected);
    });
});

describe("round trips with the sink direction", () => {
    test("dataset → Patient → dataset is stable for JANE FOX", () => {
        const dataset = {
            PatientName: [{ Alphabetic: "FOX^JANE" }],
            PatientID: "22446688",
            PatientBirthDate: "19800415",
            PatientSex: "F"
        };
        const resource = patientFromDataset(dataset);
        expect(patientToDataset(resource)).toEqual({
            PatientName: "FOX^JANE",
            PatientID: "22446688",
            PatientBirthDate: "19800415",
            PatientSex: "F"
        });
    });

    test("PatientSex M/F/O survive the round trip; empty stays empty", () => {
        for (const sex of ["M", "F", "O"]) {
            const resource = patientFromDataset({
                PatientID: "22446688",
                PatientSex: sex
            });
            expect(patientToDataset(resource).PatientSex).toBe(sex);
        }
        // empty PatientSex → gender "unknown" → empty PatientSex
        const resource = patientFromDataset({
            PatientID: "22446688",
            PatientSex: ""
        });
        expect(resource.gender).toBe("unknown");
        expect(patientToDataset(resource).PatientSex).toBe("");
    });

    test("full PN components survive", () => {
        const resource = patientFromDataset({
            PatientID: "1",
            PatientName: [{ Alphabetic: "FOX^JANE^MARIE^DR^III" }]
        });
        expect(patientToDataset(resource).PatientName).toBe(
            "FOX^JANE^MARIE^DR^III"
        );
    });
});

describe("inverse helpers", () => {
    test("humanNameToPersonName trims trailing empties", () => {
        expect(humanNameToPersonName({ family: "FOX", given: ["JANE"] })).toBe(
            "FOX^JANE"
        );
        expect(humanNameToPersonName({ given: ["JANE"] })).toBe("^JANE");
        expect(humanNameToPersonName({})).toBe(null);
        expect(humanNameToPersonName(null)).toBe(null);
    });

    test("isoDateToDicom accepts full dates and passthrough DA", () => {
        expect(isoDateToDicom("1980-04-15")).toBe("19800415");
        expect(isoDateToDicom("19800415")).toBe("19800415");
        expect(isoDateToDicom("1980-04-15T10:30:00Z")).toBe("19800415");
        expect(isoDateToDicom("1980")).toBe(null);
        expect(isoDateToDicom("1980-04")).toBe(null);
        expect(isoDateToDicom("")).toBe(null);
    });
});
