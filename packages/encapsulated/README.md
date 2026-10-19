# @dcmjs-org/encapsulated

The home for DICOM's encapsulated-document IODs. PDF (PS3.3 A.45.1, SOP
Class 1.2.840.10008.5.1.4.1.1.104.1) is here today; the other document
types (CDA, STL, OBJ, MTL) belong in the same package as they land. (Video
is encapsulated _pixel data_, not a document — it lives in
`@dcmjs-org/video`.)

Both directions of the PACS workflow where PDFs travel inside DICOM:

-   `encapsulate(bytes, options)` — the generic builder: wrap arbitrary
    document bytes into a naturalized Encapsulated Document dataset, given a
    per-type `baseDicom` (SOP class, Modality, encoding) and a `mimeType`. The
    per-type wrappers decorate it.
-   `encapsulatePdf(pdfBytes, options)` — the PDF decorator: check the PDF
    magic, then call `encapsulate` with the PDF base defaults. Produces a
    conformant naturalized dataset ready for the Part 10 writers (which mint
    the file meta group). Every UID defaults to a freshly minted one; pass
    `StudyInstanceUID` (and optionally `SeriesInstanceUID`) to attach the
    document into an existing study.
-   `extractEncapsulatedPdf(dataset)` — recover the PDF bytes, MIME type, and
    document title from a parsed (naturalized) Encapsulated PDF instance,
    byte-identical to the originally encapsulated document. The builder
    records `EncapsulatedDocumentLength (0042,0015)`, so extraction slices to
    the exact declared length; for files written without it, a single trailing
    NUL on an even-length payload is trimmed heuristically as the writer's
    odd-length pad byte.

## Inheriting context from an existing instance (hierarchical)

The default is de novo: you pass a PDF plus whatever context you have, and
everything you omit is defaulted (fresh UIDs, today's date, empty Type 2
attributes). But in a real PACS workflow you are usually attaching a report
to a study you already hold an instance of. Pass that naturalized instance
as `instance` with a `dataLevel`, and the attributes of that level and every
level above it are copied onto the document, so you don't retype them:

```js
const pdfInstance = encapsulatePdf(pdfBytes, {
    instance: existingNaturalizedInstance,
    dataLevel: "study", // patient + study context (the default)
    DocumentTitle: "Discharge Summary"
});
```

`dataLevel` is one of `'patient' | 'study' | 'series' | 'instance'` and is
cumulative: patient-level attributes flow down to every level, study adds the
General Study module, series adds the General Series module. The level Sets
and the copy itself (`patientTags` / `studyTags` / `seriesTags` and
`copyAttributesByLevel`) live in `@dcmjs-org/core` and match the Cornerstone3D
adapter names, so the vocabulary is shared. `sourceInstance` is accepted as a
back-compat alias for `instance` at `'study'` level. An array of instances
from one study is accepted — the first supplies the shared context.

Precedence is defaults < inherited < explicit options: a field you pass
explicitly always wins, otherwise the source instance supplies it, otherwise
it is defaulted. The document's own identity is never inherited —
`SOPClassUID` stays the Encapsulated PDF class, `Modality` stays `DOC`, and
`SOPInstanceUID` plus a fresh `SeriesInstanceUID` are minted so the report
becomes a new series within the source study (pass `SeriesInstanceUID`
explicitly to attach into an existing series), even when `dataLevel` reaches
series or instance. This is the lightweight, additive counterpart to the full
derivation machinery: copy the context that should carry over, mint
everything that should be new.

## Dependencies

The package builds only on `@dcmjs-org/core` (`DicomMetaDictionary`,
`copyAttributesByLevel`, the level Sets), never on `@dcmjs-org/legacy`.
`instance` is a naturalized dataset; to seed from a Part 10 file, parse it to
naturalized form first (`fromPart10` → `NaturalizedListener` in
`@dcmjs-org/parser`).
