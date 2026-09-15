# The FHIR Sink (`dcmjs.fhir`)

`@dcmjs/fhir` turns naturalized DICOM Part 10 datasets into FHIR resources:
the DICOM patient module (group 0010) becomes a `Patient`, and the
study/series/instance hierarchy becomes an `ImagingStudy` — a deliberately
thin restatement of the Part 10 elements as FHIR-flavored JSON, following the
IHE Radiology (MADO) mapping.

The contract is **strict-out**:

-   Standard FHIR only — no resource `id`s, no `meta.tag`s, no storage or
    endpoint references. Those are deployment decisions; the consumer decorates.
-   `R4` / `R4B` only (`options.fhirVersion`, default `'R4B'`) — anything else
    throws rather than emitting resources of an unverified shape.
-   Identity-less input returns `null`, never a hollow resource: a dataset with
    no `PatientName`/`PatientID` produces no `Patient`; datasets with no
    Study/Series/SOP Instance UID produce no `ImagingStudy`.

## Quick start

```javascript
import dcmjs from "dcmjs";

// One call from a .dcm ArrayBuffer:
const { patient, imagingStudy } = dcmjs.fhir.fromPart10(arrayBuffer);

// Or from an already-naturalized dataset:
const dicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);
const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
    dicomDict.dict
);
const { patient, imagingStudy } = dcmjs.fhir.toFhir(dataset);
```

Everything on `dcmjs.fhir` is also importable directly from `@dcmjs/fhir`
inside this repo.

## `toFhir()` — a worked example

Given this naturalized dataset (one CT instance):

```javascript
const dataset = {
    PatientName: [{ Alphabetic: "Doe^Jane^Q" }],
    PatientID: "MRN-0042",
    PatientBirthDate: "19741122",
    PatientSex: "F",

    StudyInstanceUID: "1.2.840.113619.2.55.3.604688119.868.1731500000.1",
    StudyDate: "20260115",
    StudyTime: "093015",
    StudyDescription: "CT CHEST W/O CONTRAST",
    AccessionNumber: "ACC-2026-0117",
    ReferringPhysicianName: [{ Alphabetic: "Osler^William" }],

    SeriesInstanceUID: "1.2.840.113619.2.55.3.604688119.868.1731500000.2",
    SeriesNumber: 2,
    SeriesDescription: "AXIAL 5MM",
    Modality: "CT",
    BodyPartExamined: "CHEST",

    SOPInstanceUID: "1.2.840.113619.2.55.3.604688119.868.1731500000.3",
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.2",
    InstanceNumber: 17
};

const { patient, imagingStudy } = dcmjs.fhir.toFhir(dataset);
```

`patient` is:

```json
{
    "resourceType": "Patient",
    "identifier": [
        {
            "use": "usual",
            "type": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                        "code": "MR",
                        "display": "Medical Record Number"
                    }
                ],
                "text": "Medical Record Number"
            },
            "value": "MRN-0042"
        }
    ],
    "name": [
        {
            "family": "Doe",
            "given": ["Jane", "Q"],
            "text": "Doe Jane Q"
        }
    ],
    "birthDate": "1974-11-22",
    "gender": "female",
    "extension": [
        {
            "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex",
            "valueCode": "F"
        },
        {
            "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-sex",
            "valueCodeableConcept": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/sex-for-clinical-use",
                        "code": "female-typical",
                        "display": "female-typical"
                    }
                ]
            }
        }
    ]
}
```

`imagingStudy` is:

```json
{
    "resourceType": "ImagingStudy",
    "status": "available",
    "numberOfSeries": 1,
    "numberOfInstances": 1,
    "identifier": [
        {
            "use": "official",
            "system": "urn:dicom:uid",
            "value": "urn:oid:1.2.840.113619.2.55.3.604688119.868.1731500000.1"
        },
        {
            "use": "usual",
            "type": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                        "code": "ACSN"
                    }
                ]
            },
            "value": "ACC-2026-0117"
        }
    ],
    "started": "2026-01-15T09:30:15",
    "description": "CT CHEST W/O CONTRAST",
    "referrer": { "display": "Osler William" },
    "modality": [
        {
            "system": "http://dicom.nema.org/resources/ontology/DCM",
            "code": "CT",
            "display": "Computed Tomography"
        }
    ],
    "series": [
        {
            "uid": "1.2.840.113619.2.55.3.604688119.868.1731500000.2",
            "number": 2,
            "modality": {
                "system": "http://dicom.nema.org/resources/ontology/DCM",
                "code": "CT",
                "display": "Computed Tomography"
            },
            "description": "AXIAL 5MM",
            "bodySite": {
                "system": "http://snomed.info/sct",
                "display": "CHEST"
            },
            "numberOfInstances": 1,
            "instance": [
                {
                    "uid": "1.2.840.113619.2.55.3.604688119.868.1731500000.3",
                    "sopClass": {
                        "system": "urn:ietf:rfc:3986",
                        "code": "urn:oid:1.2.840.10008.5.1.4.1.1.2"
                    },
                    "number": 17,
                    "title": "AXIAL 5MM"
                }
            ]
        }
    ]
}
```

Notes on the mapping:

-   **PN values** accept the naturalized shape (`[{ Alphabetic: "..." }]`),
    a bare `{ Alphabetic }`, or a raw `"Family^Given^Middle^Prefix^Suffix"`
    string — all through `parsePersonName()`.
-   **Dates/times**: `StudyDate` + `StudyTime` compose into an ISO `started`;
    a date without a usable time yields date-only.
-   **`gender`** maps M/F/O → `male`/`female`/`other`, anything else →
    `unknown`; when `PatientSex` is present, US Core `birthsex` and
    `sex-for-clinical-use` extensions are emitted alongside.
-   **Missing elements are omitted**, not emitted as empty strings.

## Many instances, one study

`toFhir()` handles one dataset. For a study's worth of instances, aggregate:

```javascript
// One ImagingStudy: instances grouped by SeriesInstanceUID, the first
// dataset anchors study-level identity (UID, accession, dates, referrer);
// study.modality is the union of distinct series modalities.
const imagingStudy = dcmjs.fhir.imagingStudyFromDatasets(
    [dataset1, dataset2, dataset3],
    { subject: { reference: "Patient/123", display: "Doe, Jane" } }
);

// Or a collection Bundle: at most one Patient (from the first dataset
// carrying a patient module) + one aggregated ImagingStudy.
const bundle = dcmjs.fhir.toBundle([dataset1, dataset2, dataset3]);
// { resourceType: "Bundle", type: "collection", total: 2, entry: [...] }
```

## Attaching a subject

The sink never invents references. When the caller has already resolved the
patient, pass a FHIR Reference and it lands on `ImagingStudy.subject`:

```javascript
const { imagingStudy } = dcmjs.fhir.toFhir(dataset, {
    subject: { reference: "Patient/123", display: "Doe, Jane" }
});
```

## Decorating downstream

Ids, tags, and storage references are the consumer's job. A typical
persistence layer does something like:

```javascript
const { patient, imagingStudy } = dcmjs.fhir.toFhir(dataset);

if (imagingStudy) {
    imagingStudy.id = myIdGenerator();
    imagingStudy.meta = {
        tag: [{ system: "https://example.org/tags", code: "binary-import" }]
    };
    imagingStudy.endpoint = [{ reference: "Endpoint/local-wado" }];
}
```

## API surface

| Function                                       | Input                                 | Output                                                   |
| ---------------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| `fromPart10(arrayBuffer, options?)`            | Part 10 ArrayBuffer                   | `{ patient, imagingStudy }` (umbrella `dcmjs.fhir` only) |
| `toFhir(dataset, options?)`                    | naturalized dataset                   | `{ patient, imagingStudy }`                              |
| `toBundle(datasets, options?)`                 | naturalized dataset array (one study) | FHIR `Bundle` (`type: collection`)                       |
| `patientFromDataset(dataset)`                  | naturalized dataset                   | FHIR `Patient` or `null`                                 |
| `imagingStudyFromDataset(dataset, options?)`   | naturalized dataset                   | FHIR `ImagingStudy` or `null`                            |
| `imagingStudyFromDatasets(datasets, options?)` | naturalized dataset array             | one aggregated `ImagingStudy` or `null`                  |

Options: `fhirVersion` (`'R4'`/`'R4B'`, default `'R4B'`, otherwise throws),
`subject` (FHIR Reference for `ImagingStudy.subject`), `readOptions`
(`fromPart10` only, forwarded to `DicomMessage.readFile`).

### Helpers

The building blocks are exported for consumers assembling their own shapes:

| Helper                                                          | Purpose                                               |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| `asString(value)` / `asNumber(value)`                           | collapse naturalized scalars/arrays defensively       |
| `uidToUrn(uid)`                                                 | `1.2.840…` → `urn:oid:1.2.840…`                       |
| `dicomDateTimeToIso(date, time?)`                               | DA/TM pair → ISO 8601                                 |
| `parsePersonName(pn)` / `personNameToHumanName(parsed)`         | PN → parts → FHIR `HumanName`                         |
| `sexToGender(sex)` / `sexToBirthSex(sex)`                       | PatientSex → administrative gender / US Core birthsex |
| `birthSexExtension(sex)` / `sexExtension(sex)`                  | ready-made US Core extensions                         |
| `modalityCoding(code)`                                          | modality code → DCM `Coding` with display             |
| `DICOM_UID_SYSTEM`, `DICOM_MODALITY_SYSTEM`, `MODALITY_DISPLAY` | system URIs + display map                             |
