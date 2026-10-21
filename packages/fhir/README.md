# @dcmjs-org/fhir

> **Status: preliminary.** The API of this package, and the FHIR methods of
> `DicomEventStream` (`fromFhir`, `toFhir`), can change in a minor release
> while this notice is here. Such a change is not a breaking change for
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

The event-stream source `DicomEventStream.fromFhir(resource, options)` (in
`src/eventStream/fromFhir.js`) turns a DocumentReference or Media with inline
data, or a Bundle that holds one, into a DICOM instance.

```js
const { patient, imagingStudy } = toFhir(naturalizedDataset);

const part10 = await DicomEventStream.fromFhir(documentReference, {
    patient,
    instance: priorStudyInstance,
    overrides: { SeriesDescription: "Scanned reports" }
}).toPart10();
```

## Scope and change rule

This README holds the requirements of `@dcmjs-org/fhir` and of
`DicomEventStream.fromFhir` and `toFhir`. The options of `fromFhir` follow
the `createInstance` requirements (CORE-USR-n) in `packages/core/README.md`.

While the status is preliminary, a user requirement (FHIR-USR-n) can change
in a minor release. After that, change a user requirement only when it
describes the behaviour wrongly, or when the intended user-facing behaviour
changes, and name the change in the pull request. The implementation
requirements (FHIR-IMP-n) describe the current approach, and can change
freely. Do not renumber an identifier.

## § User requirements

-   **FHIR-USR-1** The output is standard FHIR R4/R4B only: no resource `id`,
    no `meta.tags`, and no storage references. The consumer assigns these. An
    unsupported `fhirVersion` throws an error.
-   **FHIR-USR-2** `toFhir` maps an encapsulated document to a
    DocumentReference and no ImagingStudy, and an image to an ImagingStudy
    and no DocumentReference.
-   **FHIR-USR-3** The mapper never fabricates an identity. An instance with no
    SOPClassUID, a dataset with no SeriesInstanceUID, and a dataset with a
    different StudyInstanceUID than the first are skipped with a
    `validationLog` warning.
-   **FHIR-USR-4** A FHIR `dateTime` gets a time only when the dataset has
    `TimezoneOffsetFromUTC (0008,0201)`; otherwise it is the date only.
    `DocumentReference.date` (an `instant`) is written only with the date,
    the time, and the timezone.
-   **FHIR-USR-5** The DocumentReference attachment holds the document bytes
    exactly: `EncapsulatedDocumentLength (0042,0015)` gives the length when
    present, and each naturalized payload shape (including
    `{ InlineBinary }`) gives the same bytes.
-   **FHIR-USR-6** `patientToDataset` writes all four attributes, with an
    empty string for an absent value. A text-only HumanName becomes a
    single-component PN. A partial FHIR `birthDate` becomes empty, and never
    a fabricated day.
-   **FHIR-USR-7** `fromFhir` makes an Encapsulated PDF instance from an
    inline PDF, and an image instance that carries an inline JPEG verbatim,
    with DICOM-valid geometry and photometric interpretation. A Patient
    alone, an attachment with only a `url`, and an unsupported content type
    give a corrective error. The error comes from the sink call, not from
    the `fromFhir` factory.
-   **FHIR-USR-8** The `fromFhir` options are `patient` plus the
    `createInstance` options. The caller `overrides` win over the values from
    FHIR (demographics, DocumentTitle), and those win over the inherited and
    base values. With no FHIR title, the base or inherited `DocumentTitle`
    stays.
-   **FHIR-USR-9** A Bundle for `fromFhir` must hold exactly one
    DocumentReference or Media. Its Patient is `options.patient`, else the
    Patient that the `subject` reference names, else the only Patient. A
    `subject` that matches no Patient, or more than one Patient with no
    `subject`, throws an error, so the demographics never go to the wrong
    patient.

## § Implementation requirements

-   **FHIR-IMP-1** The package depends at run time only on `@dcmjs-org/core`
    and `@dcmjs-org/encapsulated`; the tests can use `@dcmjs-org/parser` and
    `@dcmjs-org/legacy`.
-   **FHIR-IMP-2** The document bytes come from `extractEncapsulated` of
    `@dcmjs-org/encapsulated`. The value readers (`toStringFirst`,
    `toFloatFirst`), `encodeBase64`, and `MODALITY_DISPLAY` come from
    `@dcmjs-org/core`.
-   **FHIR-IMP-3** `fromFhir` builds the instance with `encapsulatePdf` or
    `buildImageDataset` (both on `createInstance`), and reads the JPEG frame
    header with `parseJpegInfo` of `@dcmjs-org/imaging`.
-   **FHIR-IMP-4** `fromFhir.js` lives at `src/eventStream/`, beside `api.js`,
    because it composes several packages. It moves into the wrapper package
    with the facade.
