# @dcmjs-org/fhir

> **Status: preliminary.** The API of this package can change in a minor
> release while this notice is here. Such a change is not a breaking change for
> semantic versioning; the release notes name it. Pin an exact version if you
> depend on the current shape.

DICOM to FHIR R4/R4B mapping for naturalized dcmjs datasets, and the reverse
mapping of patient demographics.

-   `toFhir(dataset, options)` — `{ patient, imagingStudy, documentReference }`
    for one instance.
-   `toBundle(datasets, options)` — a `collection` Bundle: one Patient, a
    DocumentReference for each encapsulated document, and one ImagingStudy
    for the images.
-   `patientFromDataset`, `imagingStudyFromDatasets`,
    `documentReferenceFromDataset` — the single mappers.
-   `patientToDataset(patient)` — a FHIR Patient to the DICOM patient-module
    attributes (`PatientName`, `PatientID`, `PatientBirthDate`, `PatientSex`).

The wrapper `@dcmjs-org/dcmjs` does not depend on this package. An
event stream gives the naturalized dataset for `toFhir`:

```js
import { toFhir } from "@dcmjs-org/fhir";

const { patient, imagingStudy } = toFhir(await events.toNaturalized());
```

## Scope and change rule

This README holds the requirements of `@dcmjs-org/fhir`.

An earlier beta had `DicomEventStream.fromFhir()` and `toFhir()` in the
wrapper. The 1.0 wrapper removed them, because the FHIR mapping is
preliminary. FHIR-USR-7, FHIR-USR-8, FHIR-USR-9, FHIR-IMP-3, and FHIR-IMP-4
held the requirements of `fromFhir`. These identifiers are withdrawn, and
the git history keeps the old text and the old code.

While the status is preliminary, a user requirement (FHIR-USR-n) can change
in a minor release. After that, change a user requirement only when it
describes the behaviour wrongly, or when the intended user-facing behaviour
changes, and name the change in the pull request. The implementation
requirements (FHIR-IMP-n) describe the current approach, and can change
freely. Do not renumber an identifier.

## § User requirements

-   **FHIR-USR-1** The output is standard FHIR R4/R4B only, with no profile
    extensions: no resource `id`, no `meta.tags`, and no storage references.
    The consumer assigns these. An unsupported `fhirVersion` throws an
    error. The relative references of FHIR-USR-10 are the one exception.
-   **FHIR-USR-2** `toFhir` maps an encapsulated document to a
    DocumentReference and no ImagingStudy, and an image to an ImagingStudy
    and no DocumentReference.
-   **FHIR-USR-3** The mapper never fabricates a value that DICOM does not
    give, and never mixes two patients or two studies.
    -   It skips, with a `validationLog` warning: an instance with no
        SOPClassUID; a dataset with no SeriesInstanceUID or no Modality; a
        dataset of another study than the first. `toBundle` also skips a
        dataset with another PatientID than the Patient of the Bundle.
    -   `Patient.gender` comes from the administrative `PatientSex`. The
        Patient gets no birth-sex or clinical-sex extension.
    -   A number (`series.number`, `instance.number`, `numberOfFrames`) is
        written only for a non-negative integer.
    -   `BodyPartExamined` is a display with no code system. `Laterality`
        L, R, and B are SNOMED CT codes (CID 244); another value is a
        display with no code system.
-   **FHIR-USR-4** A FHIR `dateTime` gets a time only when the dataset has
    `TimezoneOffsetFromUTC (0008,0201)`; otherwise it is the date only.
    `DocumentReference.date` (an `instant`) is written only with the date,
    the time, and the timezone. The date must be `YYYYMMDD` (or the legacy
    `YYYY.MM.DD`), else there is no date; a time that is not `HHMMSS` (or the
    legacy `HH:MM:SS`) gives the date only.
-   **FHIR-USR-5** The DocumentReference attachment holds the document bytes
    exactly: `EncapsulatedDocumentLength (0042,0015)` gives the length when
    present, and each naturalized payload shape (including
    `{ InlineBinary }`) gives the same bytes. A `{ BulkDataURI }` payload
    gives `attachment.url`, and no `size` or `data`.
-   **FHIR-USR-6** `patientToDataset` writes all four attributes, with an
    empty string for an absent value. A text-only HumanName becomes a
    single-component PN. A partial FHIR `birthDate` becomes empty, and never
    a fabricated day.
-   **FHIR-USR-7**, **FHIR-USR-8**, **FHIR-USR-9** Withdrawn (see the
    scope section).
-   **FHIR-USR-10** The output links its resources without server ids.
    Without `options.subject`, `toFhir` gives the ImagingStudy or the
    DocumentReference `subject: { reference: "./patient" }`, a path relative
    to the returned object. `toBundle` gives each entry
    `fullUrl: "./entry/<index>"`, and the ImagingStudy and the
    DocumentReferences reference the Patient entry by its `fullUrl`. These
    relative references are not FHIR server references; the consumer
    replaces them when it stores the resources.

## § Implementation requirements

-   **FHIR-IMP-1** The package depends at run time only on `@dcmjs-org/core`
    and `@dcmjs-org/encapsulated`; the tests can use `@dcmjs-org/parser` and
    `@dcmjs-org/legacy`.
-   **FHIR-IMP-2** The document bytes come from `extractEncapsulated` of
    `@dcmjs-org/encapsulated`. The value readers (`toStringFirst`,
    `toFloatFirst`), `encodeBase64`, and `MODALITY_DISPLAY` come from
    `@dcmjs-org/core`.
-   **FHIR-IMP-3**, **FHIR-IMP-4** Withdrawn (see the scope section).
