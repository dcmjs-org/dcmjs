<div align="center">
  <h1>dcmjs</h1>
  <p>JavaScript implementation of DICOM manipulation. This code is an outgrowth of several efforts to implement web applications for medical imaging.  the package should also work fine on node.</p>
</div>

<hr />

[![CI](https://github.com/dcmjs-org/dcmjs/actions/workflows/publish-package.yml/badge.svg)](https://github.com/dcmjs-org/dcmjs/actions?query=workflow:publish-package)

This is a community effort so please help improve support for a wide range of DICOM data and use cases.

See [live examples here](https://master--dcmjs2.netlify.app/)

# What changed in 1.0

dcmjs 1.0 is a significant enhancement (with some API-breaking changes),
made possible by the generous support of the National Institutes of Health
and Massachusetts General Hospital. Updates include:

- **Event streaming.** Historically, reading a DICOM file meant loading the
  whole thing into memory and getting back one large object. dcmjs can now
  also treat a file as a *stream of events* — "an element started", "here
  is a value", "a sequence began" — flowing from a source, through optional
  filters, into a writer. This matters because most tasks (inspect a few
  tags, change a patient name, convert a format) never needed the whole
  file in memory in the first place, and because filters let you modify
  data in flight with a few lines of code. See Event Stream below.
- **Ultra large file support.** A consequence of event streaming: pairing
  the streaming reader with the streaming writer keeps memory bounded by
  the largest single piece of pixel data, not by the file. Digital
  pathology slides, surgical video, and large multiframe instances can be
  gigabytes — larger than available RAM — and the streaming pipeline has
  been exercised against a 21.8 GB video instance while holding only a
  couple of gigabytes in memory.
- **Deprecation of the lazy reader.** dcmjs absorbed the dicom-parser
  tokenizer and grew a "lazy" reader that records where each element lives
  and only materializes values when touched. After evaluation, the proven
  eager reader (read everything up front) remains the default engine of
  record; the lazy core is deprecated (`DCMJS_CORE=lazy` or
  `readFile(buffer, { core: "lazy" })`) and scheduled for removal.
- **More correct writing.** Element lengths are recomputed (backpatched)
  as files are written, and the deflated transfer syntax — a DICOM
  encoding that promises the file body is compressed — is now actually
  written compressed, fixing a long-standing 0.x bug where such files
  claimed compression they did not have.
- **Directory parsing.** A DICOMDIR is the index file on DICOM interchange
  media (CDs, DVDs, USB filesets) — one DICOM file whose records point at
  all the others. It now reads like any other dataset, and `dcmjs.media`
  builds new DICOMDIRs with correct byte offsets, which is the hard part
  of writing one. See Images and Directories below.
- **Interoperability support.** DICOM describes images; FHIR is how the
  rest of the healthcare IT world exchanges data. The `@dcmjs/fhir`
  package maps between the two in both directions — datasets out to FHIR
  resources, and FHIR Patient demographics back onto DICOM. See Fast
  Healthcare Interoperability below.
- **Video support.** An MP4's H.264 stream can travel inside a DICOM
  video instance *verbatim* (Supplement 225) — `fromVideo`/`toVideo`
  encapsulate and recover it byte-identically, with no transcoding and no
  pixel decoding, streaming at any file size. See Images and Directories
  below.
- **Monorepo.** The repository now hosts several packages: the vendored
  tokenizer in `packages/parser` (private), the FHIR mappers in
  `packages/fhir`, the documentation site in `packages/docs`, and the main
  `dcmjs` package at the root.
- **Removed:** the deprecated `DicomMessage.read`/`readTag` statics and the legacy
  `DICOMWEB` class (use [dicomweb-client](https://github.com/dcmjs-org/dicomweb-client)).

# Goals

_Overall the code should:_

- Support reading and writing of correct DICOM objects in JavaScript for browser or node environments
- Provide a programmer-friendly JavaScript environment for using and manipulating DICOM objects
- Include a set of useful demos to encourage correct usage of dcmjs and modern DICOM objects
- Encourage correct referencing of instances and composite context when creating derived objects
- Current target is modern web browsers, but a set of node-based utilities also makes sense someday

_Architectural goals include:_

- Use modern JavaScript programming methods (currently ES6) but avoid heavy frameworks
- Leverage modern DICOM standards but avoid legacy parts
- Support straightforward integration with multiple JavaScript deployment targets (browser, node, etc) and frameworks.

_Parts of DICOM that dcmjs *will* focus on:_

- Enhanced Multiframe Images
- Segmentation Objects
- Parametric Maps
- Structured Reports

_Parts of DICOM that dcmjs *will not* focus on:_

- DIMSE (legacy networking like C-STORE, C-FIND, C-MOVE, etc). See the [dcmjs-dimse](https://github.com/PantelisGeorgiadis/dcmjs-dimse) project for that.
- Physical Media (optical disks). See [this FAQ](https://www.dclunie.com/medical-image-faq/html/index.html) if you need to work with those.
- Image rendering. See [dcmjs-imaging](https://github.com/PantelisGeorgiadis/dcmjs-imaging) for this.
- Encapsulated transfer syntax transcoding. See [dcmjs-codecs](https://github.com/PantelisGeorgiadis/dcmjs-codecs) for this.
- 3D rendering.  See [vtk.js](https://kitware.github.io/vtk-js/index.html).
- Radiology review application - see [OHIF](https://ohif.org).
- Deidentification and data organization - see [dcm-organize](https://github.com/bebbi/dcm-organize) for this.

# Usage

## In Browser

```html
<script type="text/javascript" src="https://unpkg.com/dcmjs"></script>
```

## In Node

Add **dcmjs** to your application (pnpm):

```bash
pnpm add dcmjs       # latest stable release
pnpm add dcmjs@dev   # latest code merged to master
```

The same versions can be installed with `npm install` or Yarn in **your** project; those clients are fine for consuming the published package. **Building this repository** is pnpm-only (see below).

## Event Stream (`dcmjs.eventStream`)

A source-agnostic, SAX-style push parser. Sources emit a fixed vocabulary of
events (`startElement`, `value`, `startSequence`, `startItem`,
`bulkDataReference`, `binaryFragment`, …) to listeners/writers, with filter
middleware and backpressure — an alternative to the eager, in-place
`DicomMessage.readFile` reader that produces the same naturalized metadata by
streaming rather than materializing the whole dataset up front.

```javascript
// Part 10 bytes -> naturalized dataset, via the event stream.
// Equivalent to DicomMessage.readFile(...) + naturalizeDataset(...), streamed.
const dataset = await dcmjs.eventStream.DicomEventStream
    .fromPart10(arrayBuffer)
    .toNaturalized();

console.log(dataset.Modality, dataset.StudyInstanceUID, dataset.NumberOfFrames);
```

A `DicomEventStream` wraps a re-runnable source; choose a sink:

```javascript
const events = dcmjs.eventStream.DicomEventStream.fromPart10(arrayBuffer);

const dataset = await events.toNaturalized();    // naturalized { ...keywords }
const json    = await events.toDicomWebJson();   // DICOM JSON model
const tree    = await events.toDataSet();         // { meta, dict } tag tree
const bytes   = await events.toPart10();          // round-trip back to Part 10
const fhir    = await events.toFhir();            // { patient, imagingStudy, documentReference }
const pdf     = await events.toPdf();             // embedded PDF out of an Encapsulated PDF instance
const video   = await events.toVideo();           // byte-identical MP4 out of a video instance
```

Other sources — the same sinks apply to each:

```javascript
const { DicomEventStream } = dcmjs.eventStream;

DicomEventStream.fromPart10Stream(chunksOrReadableStream); // chunked bytes, bounded memory
DicomEventStream.fromDataSet({ meta, dict });              // an already-parsed dataset
DicomEventStream.fromDicomWebJson(dicomJson);              // DICOM JSON model
DicomEventStream.fromImage(decoded, options);              // decoded pixels (see Images and Directories)
DicomEventStream.fromPdf(pdfBytes, options);               // PDF -> Encapsulated PDF instance
DicomEventStream.fromFhir(resource, options);              // content-carrying FHIR resource (below)
DicomEventStream.fromVideo(mp4Bytes, options);             // MP4 -> video instance (see Images and Directories)
DicomEventStream.fromVideoStream(reader, options);         // same, from a { size, read } reader — any file size
DicomEventStream.from(source);                             // auto-detect Part 10 / dataset / DICOM JSON
```

`fromFhir` sources the FHIR resources that carry *content*, not just
context: a `DocumentReference` or `Media` whose attachment embeds inline
data (or a `Bundle` holding one, plus optionally a `Patient` for
demographics). An embedded PDF becomes an Encapsulated PDF instance. An
embedded JPEG — the key-image case — is carried into the instance
byte-for-byte as encapsulated PixelData, because JPEG is itself a DICOM
transfer syntax: only the frame header is read (for Rows/Columns and the
transfer syntax choice), never the pixels.

```javascript
const events = DicomEventStream.fromFhir(mediaResource, {
    patient: patientResource   // demographics applied via fhir.patientToDataset
});
const keyImage = await events.toPart10();
```

Resources that carry only context are rejected with instructions: a bare
`Patient` points at `options.patient`, and an attachment holding only a
`url` asks you to fetch the bytes first — network resolution is the
access layer's job, not this library's.

`toFhir` covers the one instance in the stream; aggregating a whole study
into a single `ImagingStudy` is a multi-stream operation — collect
naturalized datasets and use `fhir.imagingStudyFromDatasets` or
`fhir.toBundle` (see Fast Healthcare Interoperability below).

For element-level work (progress, filtering, validation) without materializing
the whole dataset, consume the events directly:

```javascript
for await (const { type, args } of
        dcmjs.eventStream.DicomEventStream.fromPart10(arrayBuffer).asyncIterable()) {
    // type: 'startElement' | 'value' | 'startSequence' | 'startItem' | ...
}

// …or drive a custom EventStreamListener subclass with events.process(listener).
```

For file-to-file processing that never holds the whole dataset, pair the
streaming source with the streaming sink: `StreamingPart10Writer` emits
Part 10 bytes chunk by chunk as events arrive, with filters applied
in-stream, so memory stays bounded by the largest pixel fragment no matter
how large the input file is:

```javascript
const { fromPart10Stream, StreamingPart10Writer } = dcmjs.eventStream;

const writer = new StreamingPart10Writer(
    { onChunk: (bytes) => output.write(bytes) },
    ...filters
);
await fromPart10Stream(inputReadableStream, writer);
```

The listener/writer classes behind the `to*` sinks (`NaturalizedListener`,
`DicomWebJsonWriter`, `Part10Writer`, `CollectorListener`) are also
exported for direct use with `process()`.

## Images and Directories

Utilities for rebuilding DICOM instances from plain images, and for reading
and writing DICOMDIR indexes.

### Instances from decoded pixels (`dcmjs.image`)

A DICOM image is more than pixels: every instance carries patient, study,
and acquisition context, and is identified by globally unique UIDs.
`buildImageDataset` and `DicomEventStream.fromImage` build a complete,
valid instance from pixels you have already decoded. dcmjs includes no
image codecs, so decode with whatever fits your environment — Canvas in
the browser, a library such as pngjs in Node — and pass the pixel array
plus its geometry. Metadata for the instance (for example, exported
alongside the image from the original DICOM file) can be supplied in DICOM
JSON or naturalized form.

```javascript
const events = DicomEventStream.fromImage(
    { pixels, rows: 256, columns: 256, bitsStored: 12 },
    { metadata: dicomWebJson, PatientName: "FOX^JANE" }
);
const part10 = await events.toPart10();
```

Two rules keep the output honest. First, measurements taken from the
actual pixels (rows, columns, bit depth, samples per pixel) always
override whatever the metadata claims. Second, when the metadata
identifies an original instance, the result is written as a *derived*
image: it receives a newly generated SOPInstanceUID, its ImageType is
marked `DERIVED\SECONDARY`, and a SourceImageSequence points back at the
original. Reusing the original UID would assert that the rebuilt file *is*
the original, which it is not — the pixels passed through an export and
back.

### Video encapsulation (`dcmjs.encapsulated`)

DICOM can carry an H.264 video stream *verbatim*: the MP4's bytes become
the encapsulated PixelData of a Video Photographic Image instance, split
into fragments that are consecutive byte ranges of the one stream
(Supplement 225). No transcoding, no pixel decoding — so extraction is
concatenation and the round trip is byte-identical. `parseMp4Info` reads
the MP4's own metadata for geometry, frame count, and frame rate, and the
H.264 profile/level selects the transfer syntax (Baseline/Main/High up to
Level 4.2; anything else gets an error naming the ffmpeg transcode to run
first). The instance records the exact stream length in the `(7FE0,0003)`
uint64 element, so the pad byte a Part 10 writer must add to an odd-length
final fragment is dropped precisely on the way out.

```javascript
const events = DicomEventStream.fromVideo(mp4Bytes, {
    PatientName: "DOE^JANE"
});
const part10 = await events.toPart10();

const { bytes } = await DicomEventStream.fromPart10(part10).toVideo();
// bytes are identical to mp4Bytes
```

For files too large to buffer, `fromVideoStream` takes a random-access
reader (`{ size, read(offset, length) }`) and reads one fragment at a
time; paired with `StreamingPart10Writer`, a 21.8 GB recording encapsulates
with peak memory of about one fragment.

### DICOMDIR builder (`dcmjs.media`)

A DICOMDIR is the index file on DICOM interchange media (CDs, DVDs, USB
filesets): one DICOM file whose directory records point at the
patient/study/series/image files. Reading one needs nothing special — it
parses like any other dataset. Writing one is harder, because each
directory record refers to the next by its absolute byte position in the
finished file. `buildDicomDirDataset` assembles the record hierarchy from
a file-set description; `writeDicomDir` computes the offsets by
serializing the records once to measure the layout, then writes the file
with the real values filled in. This is reliable because the offset
elements have a fixed four-byte encoding, so their values cannot change
the layout that was measured.

## Fast Healthcare Interoperability (`dcmjs.fhir`)

[FHIR](https://hl7.org/fhir/) (Fast Healthcare Interoperability Resources)
is the HL7 standard for exchanging healthcare data as JSON resources —
`Patient`, `ImagingStudy`, `DocumentReference`, and so on. DICOM and FHIR
describe the same patients and studies in different vocabularies, and most
imaging systems eventually need both: DICOM for the images themselves,
FHIR for how the rest of the healthcare system refers to them. The
`@dcmjs/fhir` workspace package maps between the two in both directions.
The same mappings are available on the event stream as `events.toFhir()`
and `DicomEventStream.fromFhir(resource)` — see Event Stream above.

### DICOM → FHIR

The mapping is deliberately direct: the DICOM patient module becomes a
`Patient`, the study/series/instance hierarchy becomes an `ImagingStudy`,
and an encapsulated document (such as a PDF report) becomes a
`DocumentReference`.

```javascript
// One call from a .dcm ArrayBuffer to FHIR:
const { patient, imagingStudy } = dcmjs.fhir.fromPart10(arrayBuffer);

// Or from an already-naturalized dataset:
const dicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);
const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
const { patient, imagingStudy } = dcmjs.fhir.toFhir(dataset);

// Many instances of one study -> a collection Bundle
// (one Patient + one aggregated ImagingStudy, instances grouped by series):
const bundle = dcmjs.fhir.toBundle([dataset1, dataset2, dataset3]);

// Attach a subject reference the caller resolved:
dcmjs.fhir.toFhir(dataset, {
    subject: { reference: "Patient/123", display: "Doe, John" }
});
```

API surface (all also importable from `@dcmjs/fhir` inside this repo):

| Function | Input | Output |
| --- | --- | --- |
| `fromPart10(arrayBuffer, options?)` | Part 10 ArrayBuffer | `{ patient, imagingStudy }` |
| `toFhir(dataset, options?)` | naturalized dataset | `{ patient, imagingStudy }` |
| `toBundle(datasets, options?)` | naturalized dataset array (one study) | FHIR `Bundle` (`type: collection`) |
| `patientFromDataset(dataset)` | naturalized dataset | FHIR `Patient` or `null` |
| `imagingStudyFromDataset(dataset, options?)` | naturalized dataset | FHIR `ImagingStudy` or `null` |
| `imagingStudyFromDatasets(datasets, options?)` | naturalized dataset array | one aggregated `ImagingStudy` or `null` |
| `patientToDataset(patient)` | FHIR `Patient` | DICOM patient-module attributes |

Options: `fhirVersion` (`'R4'`/`'R4B'`, default `'R4B'` — anything else
throws), `subject` (FHIR Reference for `ImagingStudy.subject`),
`readOptions` (`fromPart10` only, passed to `DicomMessage.readFile`).

Mapping notes (per the IHE Radiology MADO mapping):

- `Patient`: `PatientID` -> MR identifier, `PatientName` (PN) -> `HumanName`,
  `PatientBirthDate` -> ISO `birthDate`, `PatientSex` -> `gender` plus
  US Core `birthsex` / `sex-for-clinical-use` extensions.
- `ImagingStudy`: `StudyInstanceUID` -> `urn:dicom:uid` identifier
  (`urn:oid:` value), `AccessionNumber` -> ACSN identifier,
  `StudyDate`/`Time` -> `started`, series `Modality` -> DCM ontology coding
  (with a study-level modality union), `SeriesNumber`/`InstanceNumber`
  (IS) emitted as numbers, `SOPClassUID` -> `urn:ietf:rfc:3986` sopClass.
- Absent elements are omitted entirely — no empty strings or nulls in the
  output (permissive in, strict out).

### FHIR → DICOM

`patientToDataset(patient)` maps a FHIR `Patient` resource onto the DICOM
patient module — the PatientName, PatientID, PatientBirthDate, and
PatientSex attributes carried in every instance. This is the primitive for
updating a study's demographics from a FHIR source.

```javascript
dcmjs.fhir.patientToDataset(patientResource);
// -> { PatientName: "FOX^JANE", PatientID: "22446688",
//      PatientBirthDate: "19800415", PatientSex: "F" }
```

Where FHIR is richer than DICOM, the mapping has to choose, and the
choices are fixed here rather than left to each caller:

- A `Patient` may carry several names; the `official` name is used, never
  the `maiden` — so a resource holding both a married and a maiden name
  maps to the married one regardless of array order.
- Among multiple identifiers, one typed MR (medical record number) is
  preferred.
- `Patient.gender` is an administrative field, not clinical sex, and it is
  the only field consulted (profile extensions such as US Core birthsex
  are not): `male` -> `M`, `female` -> `F`, `other` or any unrecognized
  value -> `O`, `unknown` or absent -> empty. Empty is deliberate: DICOM
  defines PatientSex as Type 2 (must be present, may be empty), and an
  empty value is the standard way to record "not known".
- The result always contains all four attributes, with empty strings for
  anything the resource does not carry. Applying it therefore replaces the
  previous identity completely, rather than leaving stale values from a
  prior patient behind.

Tests: `pnpm exec jest packages/fhir`.

## For Developers

Building and testing this repository requires **[pnpm](https://pnpm.io/)** and **Node.js 22.13 or newer** (pnpm 11 and this repo’s tooling expect that baseline; Rollup’s dependency chain expects a modern `crypto` global). CI runs tests on Node 22 and 24, and runs the production Rollup build on Node 24. The pnpm version is pinned under `packageManager` in `package.json`. Enable [Corepack](https://nodejs.org/api/corepack.html) (`corepack enable`) and use pnpm for every install and script:

```bash
corepack enable
git clone https://github.com/dcmjs-org/dcmjs
cd dcmjs
pnpm install
pnpm run build
pnpm test
```

Other common tasks:

```bash
pnpm run build:examples         # Rollup build + copy bundles into examples/js
pnpm run lint                   # ESLint (writes fixes)
pnpm run format                 # Prettier (writes)
pnpm run format:check           # Prettier (check only)
pnpm run bench:parser           # parse non-regression gate vs published dicom-parser
pnpm run gate:parser-bundle     # parser package self-containment gate
pnpm --filter @dcmjs/docs start # documentation site dev server (packages/docs)
pnpm --filter @dcmjs/docs build # documentation site production build
```

This repository is a pnpm workspace: the main `dcmjs` package lives at the root,
the vendored read tokenizer at `packages/parser` (private, with its own jest
suite), and the Docusaurus documentation site at `packages/docs`.

**Yarn is no longer supported** for working in this repo: there is no `yarn.lock`, and installs, builds, and CI are aligned with `pnpm-lock.yaml` only. Use pnpm so dependency resolution matches lockfile and automation.

After changing dependencies in `package.json`, refresh the lockfile with `pnpm run install:update-lockfile` (or `pnpm install --no-frozen-lockfile`) before opening a PR.

## For Maintainers and Contributors

Publish new version automatically from commit:

Use the following "Commit Message Format" when drafting commit messages. If you're merging a 3rd party's PR, you have the ability to override the supplied commit messages by doing a "Squash & Merge":

- [Commit Message Format](https://semantic-release.gitbook.io/semantic-release/#commit-message-format)

Note: Be wary of `BREAKING_CHANGE` in commit message descriptions, as this can force a major version bump.

Be sure to use lower case for the first letter of your semantic commit message, so use `fix` not `Fix` or `feat` not `Feat`, have a space after the : and make the PR github review title follow the SAME rules.  It is the PR review title that determins the final commit message and will be used for semantic detection.

Note: a new package version will be published only if the commit comes from a PR.

### Optional Tooling

It is advised to use the git-cz, i.e.:

- install git-cz

```bash
pnpm add -g git-cz
# or: npm install -g git-cz
```

- how to commit

```bash
git-cz --non-interactive --type=fix --subject="commit message"
```

More info at [git-cz](https://www.npmjs.com/package/git-cz).

## DICOM Dictionary

The dcmjs library includes DICOM data dictionaries that map DICOM tags to their metadata (VR, VM, etc.). To optimize load performance, the library uses a pre-compiled "fast dictionary" format.

### Dictionary Files

- **`src/dictionary.fast.js`** - Pre-compiled fast dictionary (used at runtime)
- **`generate/dictionary.mjs`** - Source dictionary generator
- **`src/dictionary.private.data.js`** - Private tag definitions
- Since 1.0, `DicomMetaDictionary.nameMap` is built lazily on first access instead of at import time

### Updating the Dictionary

When DICOM standards are updated or new tags need to be added:

1. **Generate the dictionary from DICOM standards** (downloads latest PS3.6 and PS3.7 XML from dicom.nema.org):
   ```bash
   pnpm run generate-dictionary
   ```
   This creates/updates `generate/dictionary.js` with the latest tag definitions.

2. **Pack the dictionary into optimized format**:
   ```bash
   pnpm run pack-dictionary
   ```
   This generates the optimized `src/dictionary.fast.js` used at runtime.

### Why the Fast Dictionary?

The fast dictionary was introduced to significantly improve library load performance. The original dictionary format required complex runtime processing during module initialization, which added substantial overhead, especially in applications that frequently import dcmjs.

**Performance Benchmark Results (Bun):**

```text
Old dictionary (generate/dictionary.mjs): 181.16 ms
New dictionary (src/dictionary.fast.js):    19.04 ms
Performance improvement: 9.52x faster

ESM main (dcmjs.es.js):         112.01 ms
ESM private (loadPrivateTags):    0.01 ms
ESM total:                      112.01 ms

UMD (dcmjs.js):                  72.11 ms
```

The fast dictionary reduces initial load time by over 9x, making it especially beneficial for:
- Server-side applications that spawn multiple workers
- Build tools and bundlers
- Applications with frequent module reloading during development
- Environments where startup time is critical

## Community Participation

Use this repository's issues page to report any bugs. Please follow [SSCCE](http://sscce.org/) guidelines when submitting issues.

Use github pull requests to make contributions.

## Unit Tests

Tests are written using the [Jest](https://jestjs.io) testing framework and live in the `test/` folder. Test file names must end with `.test.js`.

Pull requests should either update existing tests or add new tests in order to ensure good test coverage of the changes being made.

To run all tests use `pnpm test`. To only run specific tests use Jest's [`.only`](https://www.testim.io/blog/unit-testing-best-practices/) feature. If you're using VS Code, an extension such as [`firsttris.vscode-jest-runner`](https://marketplace.visualstudio.com/items?itemName=firsttris.vscode-jest-runner) can be used to step through specific tests in the debugger.

Read all about unit testing best practices [here](https://www.testim.io/blog/unit-testing-best-practices/).

# Status

dcmjs is production-tested (OHIF, Cornerstone adapters, ~15k weekly npm downloads) and is currently in its 1.0 beta cycle.

## Implemented

- Eager in-place Part 10 reading (the engine of record), plus a deprecated lazy offset-based core behind `DCMJS_CORE=lazy`
- Part 10 writing with length backpatching and deflate-on-write
- Bidirectional conversion to and from part 10 binary DICOM and DICOM standard JSON encoding (as in [DICOMweb](http://dicomweb.org))
- Bidirectional conversion to and from DICOM standard JSON and a programmer-friendly high-level version (the "naturalized" form)
- Creation of derived DICOM objects such as Segmentations and Structured Reports
- Packed data dictionary with lazy initialization, character set support, anonymization, streaming reader

## In development (1.x backlog)

- Removing the deprecated lazy read core and its byte-identity passthrough write path (eager remained the engine of record after the beta evaluation)
- Retiring or re-platforming the legacy `AsyncDicomReader` — the event stream's `fromPart10Stream` is the strategic streaming path
- Public subpath packaging for the raw parser tier, and a broader TypeScript surface (the `./dictionary` and `./schema` subpaths, with schema typings, already ship)
- See the docs site roadmap page (`packages/docs/docs/development/roadmap.md`, R8 checklist) for the full list

# History

- 2014
  - [DCMTK](dcmtk.org) cross compiled to javascript at [CTK Hackfest](http://www.commontk.org/index.php/CTK-Hackfest-May-2014). While this was useful and powerful, it was heavyweight for typical web usage.
- 2016
  - A [Medical Imaging Web Appliction meeting at Stanford](http://qiicr.org/web/outreach/Medical-Imaging-Web-Apps/) and [follow-on hackfest in Boston](http://qiicr.org/web/outreach/MIWS-hackfest/) helped elaborate the needs for manipulating DICOM in pure Javascript.
  - Based on [DICOM Part 10 read/write code](https://github.com/OHIF/dicom-dimse) initiated by Weiwei Wu of [OHIF](http://ohif.org), Steve Pieper [developed further features](https://github.com/pieper/sites/tree/gh-pages/dcmio) and [examples of creating multiframe and segmentation objects](https://github.com/pieper/sites/tree/gh-pages/DICOMzero) discussed with the community at RSNA
- 2017
  - At [NA-MIC Project Week 25](https://na-mic.org/wiki/Project_Week_25) Erik Ziegler and Steve Pieper [worked](https://na-mic.org/wiki/Project_Week_25/DICOM_Segmentation_Support_for_Cornerstone_and_OHIF_Viewer)
    with the community to define some example use cases to mix the pure JavaScript DICOM code with Cornerstone and [CornerstoneTools](https://github.com/chafey/cornerstoneTools).
- 2018-2022
  - Work continues to develop SR and SEG support to [OHIFViewer](http://ohif.org) allow interoperability with [DICOM4QI](https://legacy.gitbook.com/book/qiicr/dicom4qi/details)
- 2022-present
  - dcmjs is used by a number of projects and as of January 2025 has about 15,000 weekly [downloads from npm]([url](https://www.npmjs.com/package/dcmjs)).

# Support

The developers gratefully acknowledge their research support:

- The [National Institutes of Health](https://www.nih.gov/)
- [Massachusetts General Hospital](https://www.massgeneral.org/)
- Open Health Imaging Foundation ([OHIF](http://ohif.org))
- Quantitative Image Informatics for Cancer Research ([QIICR](http://qiicr.org))
- [Radiomics](http://radiomics.io)
- The [Neuroimage Analysis Center](http://nac.spl.harvard.edu)
- The [National Center for Image Guided Therapy](http://ncigt.org)
- The [NCI Imaging Data Commons](https://imagingdatacommons.github.io/) NCI Imaging Data Commons: contract number 19X037Q from Leidos Biomedical Research under Task Order HHSN26100071 from NCI
- dcmjs is being used and partially supported by [dicom-curate](https://github.com/bebbi/dicom-curate)

## Logging

This library uses [loglevel](https://github.com/pimterry/loglevel) for logging through a named child logger (`loglevel.getLogger("dcmjs")`). Since 1.0, importing dcmjs no longer calls `setLevel` on the global loglevel root logger, so host application logging configuration is left untouched. The dcmjs logger defaults to "warn"; change it with the `LOG_LEVEL` environment variable or `loglevel.getLogger("dcmjs").setLevel(...)` in your code.
