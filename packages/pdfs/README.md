# @dcmjs-org/pdfs

Encapsulated PDF (PS3.3 A.45.1, SOP Class 1.2.840.10008.5.1.4.1.1.104.1),
both directions of the PACS workflow where PDFs travel inside DICOM:

- `encapsulatePdf(pdfBytes, options)` — wrap PDF bytes into a conformant
  naturalized dataset, ready for the Part 10 writers (which mint the file
  meta group). Every UID defaults to a freshly minted one; pass
  `StudyInstanceUID` (and optionally `SeriesInstanceUID`) to attach the
  document into an existing study.
- `extractEncapsulatedPdf(dataset)` — recover the PDF bytes, MIME type, and
  document title from a parsed (naturalized) Encapsulated PDF instance,
  byte-identical to the originally encapsulated document.

This is a de novo builder, deliberately not a derivation — derivations copy
patient/study context from a referenced source instance; an encapsulated PDF
starts from a plain PDF plus caller-supplied context.

The package builds only on `@dcmjs-org/core` (`DicomMetaDictionary`), never on
`@dcmjs-org/legacy`.
