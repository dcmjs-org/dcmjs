# @dcmjs-org/encapsulated

The home for DICOM's encapsulated-document IODs. PDF (PS3.3 A.45.1, SOP
Class 1.2.840.10008.5.1.4.1.1.104.1) is here today; the other document
types (CDA, STL, OBJ, MTL) belong in the same package as they land. (Video
is encapsulated _pixel data_, not a document — it lives in
`@dcmjs-org/video`.)

-   `encapsulate(bytes, options)` — the generic builder. It calls
    `createInstance` from `@dcmjs-org/core`, then sets the document payload.
-   `encapsulatePdf(pdfBytes, options)` — checks the PDF magic, then calls
    `encapsulate` with `encapsulatedPdfBase`.
-   `extractEncapsulatedPdf(dataset)` — recovers the PDF bytes, MIME type, and
    document title from a parsed (naturalized) Encapsulated PDF instance.

```js
const pdfInstance = encapsulatePdf(pdfBytes, {
    instance: existingNaturalizedInstance, // or an array; the first is read
    dataLevel: "study", // the default
    DocumentTitle: "Discharge Summary"
});
```

## Scope and change rule

The user requirements say what a caller can rely on. Change one only when it
describes the behaviour wrongly, or when the intended behaviour changes, and
say so in the pull request. The implementation requirements describe the
current approach, and can change freely.

## § User requirements

-   **ENC-USR-1** Without `instance`, the result is a new object: a new
    study, series, and SOP instance, today's dates, and empty Type 2
    attributes.
-   **ENC-USR-2** With `instance`, the attributes of `dataLevel` and of every
    level above it come from `instance`. The levels below `dataLevel` are new.
    -   `patient`: the same patient, in a new study.
    -   `study` (the default): the same study, in a new series.
    -   `series`: the same series (its UID, number, and description), as a new
        SOP instance.
    -   There is no `instance` level. Instance attributes, for example a
        specific `SOPInstanceUID`, are explicit options.
-   **ENC-USR-3** Precedence is base < inherited < explicit options. An
    explicit option always wins.
-   **ENC-USR-4** The MIME type is `mimeType`, else the explicit or inherited
    `MIMETypeOfEncapsulatedDocument`, else the base value.
-   **ENC-USR-5** When an inherited `Modality` or `SOPClassUID` differs from
    the base, the builder logs a warning and keeps the inherited value.
-   **ENC-USR-6** `extractEncapsulatedPdf` returns the bytes that were
    encapsulated, byte for byte, including an even-length document that ends
    in a zero byte.
-   **ENC-USR-7** A caller can replace any one base block, or add one, without
    a copy of the other blocks.
-   **ENC-USR-8** With `predecessor: true`, the new document lists each
    `instance` in `PredecessorDocumentsSequence (0040,A360)`. The new document
    replaces the older ones, and the older documents are not changed or
    deleted. Use `dataLevel: "series"` to put the new version in the series of
    the old one.

## § Implementation requirements

-   **ENC-IMP-1** The merge, the levels, and the core base blocks live in
    `@dcmjs-org/core` (`createInstance`, `copyAttributesByLevel`,
    `DATA_LEVELS`). This package adds only the document blocks and payload.
-   **ENC-IMP-2** `baseDicom` is a base block: an object, a function
    `(context) => object`, an array of blocks, or `combineBases(...blocks)`.
    Later blocks win. A combined block keeps its parts on `.items`.
-   **ENC-IMP-3** The default bases are compositions, not extensions:
    -   `defaultInstanceBase` (core): `patientBase`, `studyBase`, `seriesBase`,
        `instanceBase`, `equipmentBase`.
    -   `encapsulatedBase`: `defaultInstanceBase` + `encapsulatedDocumentBase`
        (SC Equipment conversion fields, Encapsulated Document module) +
        `predecessorBase`.
    -   `encapsulatedPdfBase`: `encapsulatedBase` parts + `pdfBase` (SOP class,
        Modality `DOC`, `application/pdf`).
-   **ENC-IMP-4** The level blocks create new identity only for the levels
    below `dataLevel`, through `context.inherits(levelName)`. A function block
    such as `nextSeriesNumberBase(qidoSeries, filter)` can compute a value
    from other data.
-   **ENC-IMP-5** The levels are a list of `{ name, tags }`, passed as
    `levels`. `extendDataLevels` adds attributes to a level; a new level is a
    new entry. The level Sets use the
    Cornerstone3D adapter names; dcmjs also has `PatientAge`, `PatientSize`,
    and `PatientWeight` at study level.
-   **ENC-IMP-6** Inherited object values (sequences, PN objects, binary) are
    shared with `instance`. To clone them, pass
    `instance: deepCloneInstance(source)` (from `@dcmjs-org/core`). Binary
    values stay shared unless `{ copyBinary: true }` is given, because a copy
    of large binary data can run out of memory. `deepCloneInstance(block)`
    wraps a function block, so each call returns a clone; a promise gives a
    promise for a clone. The builder freezes nothing, so a caller can change
    the result after the call.
-   **ENC-IMP-7** `_meta` is Explicit VR Little Endian from `instanceBase`. A
    writer that stores another transfer syntax must update it.
-   **ENC-IMP-8** `EncapsulatedDocumentLength (0042,0015)` records the exact
    length, and extraction slices to it. Without the element, extraction
    trims one trailing NUL from an even-length payload, as the writer's pad
    byte.
-   **ENC-IMP-9** `predecessorBase` (core) reads the `predecessor` context
    flag and builds the sequence with `hierarchicalReferences(instances)`: one
    item for each study, then each series, then each SOP instance. It is in
    the encapsulated bases only, not in `defaultInstanceBase`. The
    Encapsulated Document module does not define the attribute, but does not
    forbid it, so it is a Standard Extended SOP Class attribute.

## Dependencies

The package builds only on `@dcmjs-org/core`, never on `@dcmjs-org/legacy`.
`instance` is a naturalized dataset; to seed from a Part 10 file, parse it to
naturalized form first (`fromPart10` → `NaturalizedListener` in
`@dcmjs-org/parser`).
