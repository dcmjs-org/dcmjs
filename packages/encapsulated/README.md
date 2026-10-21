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
    instance: existingNaturalizedInstance, // or an array (CORE-USR-14)
    dataLevel: "study", // the default
    DocumentTitle: "Discharge Summary"
});
```

## Scope and change rule

The options and the merge of `encapsulate` follow the shared requirements of
`createInstance`: CORE-USR-1 to CORE-USR-14 and CORE-IMP-1 to CORE-IMP-10 in
`packages/core/README.md`. This README lists only the requirements of this
package.

The change rule of the core README applies. Change a user requirement
(ENC-USR-n) only when it describes the behaviour wrongly, or when the
intended user-facing behaviour changes, and name the change in the pull
request. The implementation requirements (ENC-IMP-n) describe the current
approach, and can change freely. Do not renumber an identifier.

## § User requirements

-   **ENC-USR-4** The MIME type is `mimeType`, else the override or inherited
    `MIMETypeOfEncapsulatedDocument`, else the base value. The control key
    `mimeType` replaces an override of `MIMETypeOfEncapsulatedDocument`.
-   **ENC-USR-5** When an inherited `Modality` differs from the base
    `Modality` (`DOC` for PDF), the builder logs a warning and keeps the
    inherited value (CORE-USR-10).
-   **ENC-USR-6** `extractEncapsulatedPdf` returns the bytes that were
    encapsulated, byte for byte. This rule also applies to an even-length
    document that ends in a zero byte.
-   **ENC-USR-9** The result never gets the `SOPInstanceUID`, `SOPClassUID`,
    `InstanceNumber`, `MediaStorageSOPInstanceUID`, or
    `MediaStorageSOPClassUID` of `instance`, also with a custom `levels`
    (CORE-USR-4). An override sets a value of the identity. Without an
    override, the base blocks set the identity: a new `SOPInstanceUID`, the
    `SOPClassUID` of the document class (Encapsulated PDF for
    `encapsulatedPdfBase`), and the `InstanceNumber` of CORE-USR-5.
-   **ENC-USR-10** The payload attributes are `EncapsulatedDocument` and
    `EncapsulatedDocumentLength`. `encapsulate` sets them from `bytes` after
    `createInstance`, and replaces an override of them. `encapsulate` adds
    `EncapsulatedDocument: "OB"` to the `_vrMap` of the result, and keeps the
    other `_vrMap` entries. The only control key of `encapsulate` is
    `mimeType` (CORE-USR-1).

These user requirements moved to `@dcmjs-org/core`. The identifiers stay
reserved:

-   **ENC-USR-1** → CORE-USR-2 (a new object without `instance`).
-   **ENC-USR-2** → CORE-USR-3 (the levels) and CORE-USR-5 (the
    `InstanceNumber`).
-   **ENC-USR-3** → CORE-USR-6 (the precedence).
-   **ENC-USR-7** → CORE-USR-11 (replace or add a base block).
-   **ENC-USR-8** → CORE-USR-9 (the predecessor). `encapsulatedBase` and
    `encapsulatedPdfBase` have `predecessorBase`.

## § Implementation requirements

-   **ENC-IMP-1** The merge, the levels, and the core base blocks are in
    `@dcmjs-org/core` (`createInstance`, `copyAttributesByLevel`,
    `DATA_LEVELS`). This package adds only the document blocks and the
    payload.
-   **ENC-IMP-3** The bases of this package are compositions of
    `defaultInstanceBase` (CORE-IMP-3):
    -   `encapsulatedBase`: `defaultInstanceBase` + `encapsulatedDocumentBase`
        (SC Equipment conversion fields, Encapsulated Document module) +
        `predecessorBase`.
    -   `encapsulatedPdfBase`: the parts of `encapsulatedBase` + `pdfBase`
        (SOP class, Modality `DOC`, `application/pdf`).
-   **ENC-IMP-8** `EncapsulatedDocumentLength (0042,0015)` records the exact
    length, and extraction slices to it. Without the element, extraction
    removes one NUL at the end of an even-length payload, as the pad byte of
    the writer.
-   **ENC-IMP-9** The Encapsulated Document module does not define
    `PredecessorDocumentsSequence`, but does not forbid it. The attribute is a
    Standard Extended SOP Class attribute (CORE-IMP-8).
-   **ENC-IMP-10** `encapsulate` removes its control key `mimeType` before it
    calls `createInstance` (CORE-IMP-9).

These implementation requirements moved to `@dcmjs-org/core`:

-   **ENC-IMP-2** → CORE-IMP-2 (the shape of a base block).
-   **ENC-IMP-4** → CORE-IMP-4 (the context and the producer blocks).
-   **ENC-IMP-5** → CORE-IMP-5 (the level list).
-   **ENC-IMP-6** → CORE-IMP-6 (shared object values, `deepCloneInstance`).
-   **ENC-IMP-7** → CORE-IMP-7 (`_meta`).

## Dependencies

The package builds only on `@dcmjs-org/core`, never on `@dcmjs-org/legacy`.
`instance` is a naturalized dataset; to seed from a Part 10 file, parse it to
naturalized form first (`fromPart10` → `NaturalizedListener` in
`@dcmjs-org/parser`).
