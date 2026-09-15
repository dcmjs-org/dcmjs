# CLAUDE_REFACTOR_ANALYSIS.md — Decision Log for the Unified dcmjs Refactor

This document records the questions asked during the brainstorming/planning session
and the answers given, so the reasoning behind `CLAUDE_REFACTOR_PLAN.md` is traceable.
It is a decision log, not a plan. Each entry: the question, the options considered,
the decision, and why.

Source material: the **Unified dcmjs Architecture Proposal** and the **Naturalized
DICOM Metadata Behavior Specification** (provided by the user). Section references
(§) point into the Naturalized spec unless noted.

---

## D0. Scope — is this one refactor or many?

**Question:** The request was "refactor all of it" against ~40 pages of specs. Is this
a single design/plan, or does it need decomposition?

**Decision:** Decompose. The specs describe a *platform* (4 layers), not a utility.
Per the brainstorming process, a request spanning multiple independent subsystems is
split into sub-projects, each with its own spec → plan → implementation cycle.

**Decomposition (dependency-ordered):**

| # | Sub-project | Depends on | Repo status at analysis time |
|---|---|---|---|
| **A** | Event-stream contract | — | partial (listener middleware exists) |
| B | Part 10 → event-stream generator | A | partial (lazy core done) |
| C | DICOMweb JSON → event-stream generator | A | not built |
| D | Naturalized listener + value model (bulk of metadata spec) | A, B | partial (roadmap R3) |
| E | Writers on event stream (Part 10 + DICOMweb) | A | partial (backpatch writer, R4) |
| F | Public source/sink API + compat wrappers | A–E | not built |
| G | Cross-source equivalence suite (§31) | A–F | not built |

**Confirmed:** the two pasted documents are the complete spec set (no more pages coming).

---

## D1. Which slice first?

**Question:** Which sub-project do we brainstorm and build first?

**Options:** A (event-stream contract) · D (naturalized value model — the meat) ·
B (Part 10 generator).

**Answer:** **A — Event-stream contract.**

**Why:** It is the keystone. B, C, D, and E are all *defined as* producers/consumers
of the contract (§4.3, §4.4). Settle the vocabulary first and the naturalized listener
(D) becomes a well-bounded consumer; start with D and we'd reverse-engineer the
contract anyway. It is also partly grounded already in
`src/utilities/DicomMetadataListener.js`, so slice A is "formalize + enrich + decide
the things the current code dodges" rather than green-field.

---

## D2. Push or pull model for the event stream?

**Question:** Is the canonical contract a push/callback listener or a pull/async-iterator?

**Options:** Push/callback · Pull/async-iterator · Hybrid (push core + pull adapter).

**Answer:** **Hybrid — push/callback is canonical, async-iterator layered on top.**

**Why:** §24/§24.1 require the stream to be transport-oriented (the `openInlineBinary`
function must never be a payload; parsed-JSON generation should call listener callbacks
directly "without constructing intermediate event objects"), and §15.4 requires low
allocation. That points to push/callback for the canonical path. The pull adapter is
kept for ergonomics (`for await`) without forcing event-object allocation on consumers
who don't want it.

---

## D3. How async is the push core?

**Question:** Should callbacks be awaitable, and where does backpressure happen?

**Options:** Sync calls + async checkpoints · Fully async callbacks · Fully sync,
no backpressure in the contract.

**Answer:** **Sync calls + async checkpoints.**

**Why:** Streaming/backpressure is a first-class goal (§4.3, §15.4) and the existing
code already has `setDrain`/`awaitDrain`. But putting a promise on every
`value()`/`startElement()` call would fight the allocation-free hot path. So
structural/value callbacks are synchronous; the generator awaits backpressure only at
defined points — top-level element boundaries and binary-fragment emission — matching
the existing `awaitDrain` usage in `AsyncDicomReader._emitSplitValues`.

---

## D4. How is binary / bulk / encapsulated pixel data represented?

**Question:** What events carry binary data, references, and fragment boundaries?

**Options:** Fragment sub-stream + reference event · Single buffer/reference value
event · Fragment sub-stream now, references deferred.

**Answer:** **Fragment sub-stream + reference event.**

**Why:** §33 requires fragment boundaries be preservable (lossless writers need them
for encapsulated transfer syntaxes); §26's `BinaryOutputMode`
(preserveReference/inline/stream/resolveAndInline) requires the stream to carry *either*
an unfetched reference *or* bytes; §24 requires the `openInlineBinary` function never be
emitted. So:
- `bulkDataReference({ uri, sourceContext })` — by-reference, nothing fetched (`BulkDataURI`)
- `startBinary` → `binaryFragment*` → `endBinary` — covers `InlineBinary` (one fragment),
  `openInlineBinary`, and encapsulated pixel data (many fragments, boundaries kept).

A single-buffer `value()` event was rejected because it collapses fragment boundaries
and pushes toward eager materialization, weakening §33/§26.

---

## D5. File Meta Information representation

**Question:** Is group-0002 inline, or a separate sub-stream?

**Answer (accepted via "continue"):** **Separate bracketed sub-stream**
(`startFileMetaInformation`/`endFileMetaInformation`) emitted first, so a listener knows
the transfer syntax before the main dataset arrives (§33). Replaces the ad-hoc `fmi`
field on today's listener.

---

## D6. Source-byte spans in the vocabulary

**Question:** Bake optional `sourceSpan {start,end}` into structural events now, or add later?

**Answer (accepted via "continue"):** **Bake it in now**, optional and ignorable.
The parser already produces `startOffset`/`endOffset` (roadmap R0, confirmed in
`packages/parser/src/readDicomElementExplicit.js`). The passthrough writer (slice E / R4)
needs it; retrofitting it into the vocabulary later would be a breaking change. The one
deliberate forward-looking concession.

---

## D7. Where does slice A's reference generator live?

**Question:** What proves the contract against real bytes?

**Options:** New standalone tree-walker over the parser `DataSet` · Adapt
`AsyncDicomReader`'s existing push calls · Both (standalone now, AsyncDicomReader later).

**Answer:** **New standalone tree-walker over the parser `DataSet`.**

**Why:** Exploration found two read paths — `AsyncDicomReader` (drives the listener, but
has the vocabulary gaps and still uses the eager `_read` for meta; its full re-platform
is deferred to 1.x/R6) and `LazyDicomReader` (pull/getter-based, no listener). A standalone
walker over the parser's already-parsed `DataSet` tree (offsets present, `items[].dataSet`,
`fragments`/`basicOffsetTable`) is the smallest blast radius and stays out of the deferred
streaming work, while reusing `ValueRepresentation` for decoding.

---

## D8. Slice B depth (raw-bytes Part 10 generator)

**Question:** How deep should the bytes→events generator go?

**Options:** Real walker reusing decode primitives · Reuse the lazy core's exact decode ·
Thin adapter over the lazy core.

**Answer:** **Real walker, reuse decode primitives.** A genuine bytes→events path and the
streaming foundation, validated against the same corpus gate.

## D9. Slice B approach (decode core is trapped)

**Finding:** exploration revealed the decode core (`materializeElement`,
`resolveVrInstance`, charset/ctx setup, deflate dual-buffer) is **closures trapped inside
`readFileLazy`** — only `readFileLazy` is exported. Faithful "reuse primitives" therefore
means re-deriving ~30–40% of the lazy core, which converges with extracting it.

**Options:** Scoped walker now + extract core later · Extract shared decode core now ·
Independent walker reproducing routing.

**Answer:** **Scoped walker now, extract core later.** Ship the common path (explicit/
implicit LE + big-endian, sequences, raw encapsulated fragments, defined-length binary,
charset) reusing public primitives; **delegate** hard cases (deflate, undefined-length
non-SQ / unknown-VR) to `fromDataSet(readFile(...))` for the whole file. The shared-core
extraction ("one read core", roadmap goal) is a scheduled follow-up.

**Implementation gotcha found during TDD:** dcmjs's `isBinary()` is true for *numeric* VRs
(`FL/FD/SL/SS/UL/US/AT/UV`) which decode to **numbers**, not byte blobs; the byte-blob VRs
(OB/OW/OF/OD) are not in `binaryVRs`. So the walker routes by the **decoded value type**
(ArrayBuffer → binary sub-stream; else → `value()`), not by `isBinary()`.

## D10. Slice C value handling (DICOMweb JSON generator)

**Question:** How should the DICOMweb JSON generator handle values that differ in
representation from the Part 10 path (PN `{Alphabetic}` vs string, `InlineBinary` base64
vs bytes, JSON numbers vs IS/DS strings)?

**Options:** Emit as-is, defer canonicalization to slice D · Canonicalize at generation now.

**Answer:** **Emit as-is, defer canonicalization to slice D.** The generator is a faithful
transport: PN stays the DICOMweb `{Alphabetic}` object, numbers stay numbers, `BulkDataURI`
→ `bulkDataReference`, `InlineBinary` base64 → decoded buffer (§22/§24.1). Cross-source
value reconciliation (PN proxy — still an open spec decision §17 — and IS/DS normalization,
§28) lands in the naturalized listener (slice D). Keeps slice boundaries clean; the
slice-C cross-source gate asserts structure + unambiguous values and defers PN/number
equality to D.

## D11. Decompose slice D?

**Question:** Slice D (VM cardinality + PN proxy + private grouping + precision/raw
retention) is large. Decompose it?

**Answer:** **D1 core now, D2 (PN/private/raw) later.** D1 = keyword keys + VM cardinality
+ sequences + binary assembly + cardinality policy. D2 = PN proxy (§17, open spec
decision), private-tag grouping (§18), precision/raw retention (§16/§27 — needs a contract
extension to carry raw values).

## D12. Default cardinality-violation policy (§15.2)

**Answer:** **warnAndPreserve** — keep all observed values (loss-preserving) and emit a
skippable diagnostic; configurable to discardExtra/record/throw. Violations also exposed on
`listener.violations`.

**Interpretation established during D1:** a DICOM sequence's declared VM ("1") constrains
attribute occurrence, not item count. Multi-item sequences (e.g.
PerFrameFunctionalGroupsSequence, declared VM 1) are normal — NOT cardinality violations.
A literal reading of §12 would warn on every enhanced/multi-frame object; the engineering
call is that violations apply only to non-sequence scalar VRs whose value count exceeds the
declared VM.

## D13. PN proxy shape (§17, resolving the spec's open decision)

**Question:** §17 leaves PN proxy/list behavior for VM 1 vs VM n open, including whether
`PatientName.Alphabetic` is supported directly for VM 1.

**Decision:** VM 1 → the `{Alphabetic, Ideographic, Phonetic}` object itself, so
`.Alphabetic` works directly, plus non-enumerable `toString()` (→ raw PN string) and
`toJSON()`. VM n → array of those objects with array-level `toString()` joining components
with `\`. Reuse `dicomJson.pnAddValueAccessors` (idempotent, non-enumerable, so cross-source
structural equality is unaffected). `toJSON` serializes to the DICOM JSON model (PN Value is
an array of component objects), matching dcmjs's existing convention.

## D14. Precision / raw retention (§16/§27)

**Decision:** Extend the contract's `value` event with an optional `rawValue` (backward
compatible). `fromPart10` and `fromDataSet` (the Part-10-derived sources) emit it;
`fromDicomWebJson` does not (JSON already chose a number). The naturalized listener retains
the raw source string whenever a numeric value's shortest decimal (`value.toString()`)
doesn't reproduce the source string — a VR-agnostic round-trip check, so normal values keep
their JS number. Default matches §27 "inexact only".

**Gotcha found during TDD:** the spec's "large integer" example can't be an `IS` — IS is
capped at 12 characters, so it never overflows JS safe integers. The real string-retention
case is `DS` (≤16 characters), whose double can drop the final digit (e.g. the 16-char
"9007199254740993" → 9007199254740992). The retention rule is therefore round-trip-based,
not VR-specific.

## D15. Part 10 byte writer — reuse vs. a second encoder

**Question (raised by the user):** Would a streaming event-driven byte encoder replace the
old writer, or just add duplication?

**Finding:** the existing `DicomMessage.write` IS the canonical byte encoder and already does
byte-faithful output incl. R4 verbatim passthrough. A streaming event encoder would
**duplicate** its encoding logic, not deprecate it — its only added benefit is not buffering
the dataset while writing (a niche need). Byte-identical Part 10 round-trip is also an
explicit **non-goal** of the event/naturalized path (spec §4.5) and is already served by the
lazy-read + passthrough-write path.

**Decision:** build E2 as a thin LAYER over the canonical encoder — collect events into
`{meta, dict}` and call `DicomDict.write()`. This is correct layering, not a patch; it avoids
a second encoder. A streaming + passthrough event encoder is deferred until streaming writes
of giant datasets are a real requirement, at which point it is an *addition* for that need.

## Grounding facts established during exploration

- Parser element shape (confirmed): `tag`, `tagValue` (numeric), `vr`, `length`,
  `dataOffset`, `startOffset`, `endOffset`, `hadUndefinedLength`, `items`, `fragments`,
  `basicOffsetTable`, `encapsulatedPixelData`. Sequence items carry `dataSet`.
- The de-facto event vocabulary today: `addTag` / `startObject` / `pop` / `value`
  threaded through a `next`-middleware chain (`DicomMetadataListener._createMethodChains`,
  lines 191-219). Sequences and items are both "objects" — not distinguished.
- Backpressure already exists: `setDrain`/`awaitDrain` (DicomMetadataListener 95-108),
  used in `AsyncDicomReader._emitSplitValues` (~line 367).
- Binary today: fragmented `ArrayBuffer`s via `value()`, expanded by
  `ArrayBufferExpanderFilter` into `startObject([])`/`value`*/`pop`.
- Listener consumers to preserve: `AsyncDicomReader` + 5 test files
  (`ArrayBufferExpanderListener.test.js`, `information-filter.test.js`,
  `defined-length-sequence.test.js`, `async-data.test.js`, plus `video-test-dict.js`).
- Test conventions: Jest; corpus via `discoverFixtures` over `packages/parser/testImages/`
  + `test/*.dcm|.lei`; deep-compare via `test/helper/equivalence.js`; dual-core gate
  `DCMJS_CORE=eager pnpm test`; existing `test/lazy-equivalence.test.js` is the template.

---

# Review Round 1 — Steve Pieper comments on the Architecture Proposal

Source: inline comments on the **"dcmjs 1.0: consolidating DICOM metadata onto a single
defined path"** Google Doc (2026-06-30). These are the first external review of the proposal.
Several resolve open questions the proposal itself left in §12.4; a few add new scope.
Entries below continue the D-numbering. Answers marked **Draft** are proposals awaiting the
user's confirmation before they become binding; those marked **Decision** are mechanical.

## D16. Byte identity — is it a 1.0 goal? (resolves proposal §12.4; reconciles with D15)

**Comment:** on "commits to byte identity as a goal, which is a much larger effort" — *"yes,
this should be the goal — we want any unedited parts of the header to remain exactly unchanged."*

**The tension:** D15 and spec §4.5 recorded byte-identical Part 10 round-trip as a **non-goal**
*of the event/naturalized path*. Steve is asking for byte identity. These are only in conflict
if "byte identity" means one thing. It doesn't — there are two distinct guarantees:

- **Per-element verbatim passthrough** — every element the caller did *not* edit is re-emitted
  from its original source bytes, unchanged. Edited elements are re-encoded. Delivered by the
  `sourceSpan {start,end}` mechanism baked into the vocabulary in **D6** and the R4
  dirty-tracking passthrough writer.
- **Whole-file byte identity** — the entire file, meta group and deflate wrapper included, is
  bit-for-bit reproducible by re-serializing.

**Answer (REVISED 2026-07-03, graph-grounded — the original draft understated what exists):**
The repo **already documents and tests a body-level byte-identity guarantee** on the lazy-read +
passthrough-write path: for an eligible file read by the lazy core, written back with the same
transfer syntax, default options, passthrough-safe charset, and **zero edits**, the writer
reproduces the dataset **body byte-for-byte** — verbatim source spans *including sequence
delimiters, padding, and encapsulated fragment framing*
(`packages/docs/docs/architecture/writer.md:167` "The byte-identity guarantee"; enforced by
`assertNoEditWriteIsBodyIdentical`, `test/write-passthrough.test.js:275`). Only the meta group
is re-encoded (group length recomputed) and deflated wrapper bytes may differ.

Two consequences:
1. **The proposal's §12.4 premise is stale for this repo.** "Whole-file byte identity is
   impossible today — the writer re-derives VR and length and reorders tags" describes the
   *legacy* `DicomMessage.write`, not the dirty-tracking passthrough writer that now ships. The
   reply to Steve should say this, not concede "a much larger effort."
2. **Steve's ask — "any unedited parts … remain exactly unchanged" — is already delivered** on
   the lazy read-modify-write path. The genuine remaining gaps are: (a) the meta-group
   re-encode, (b) deflate wrapper bytes, and (c) **the event/naturalized path** — `Part10Writer`
   deliberately layers over `DicomDict.write` (D15) and does not passthrough, and anything
   routed through `naturalize`/`denaturalize` re-encodes. Gap (c) is the real 1.0 question,
   and it is exactly what dicom-curate needs (D25): the slice-I migration target is "get
   curation flows onto the passthrough path," not "build a new capability."

**Recommendation:** 1.0 commits to the **existing body-level byte-identity guarantee** on the
lazy+passthrough path as a stated, spec'd behavior; extends "unedited parts unchanged" to the
event-stream path as the R2 streaming/passthrough encoder's acceptance criterion (that is what
promotes R2 from "niche" to "requirement"); and scopes meta-group/deflate-wrapper bit-identity
as explicit open questions rather than silently out. Still confirm with Steve that "unedited
parts unchanged" (element/body level) is the intended reading.

## D17. Browser writer sink — File System Access API (extends D15 / §8 API)

**Comment:** on `Part10.writeFile(events, "out.dcm")` targeting Node — *"or File System Access API."*

**Decision:** browser output sink targets the **File System Access API**
(`showSaveFilePicker()` → `FileSystemWritableFileStream`), paired with the Node `fs` path. The
event-driven writer feeds a `WritableStream` sink either way. Near term the sink can accept the
buffered bytes the current `Part10Writer` (layered over `DicomDict.write`, per D15) produces; a
truly *streaming* FSA sink that never buffers the whole file rides along with the deferred
streaming encoder (R2). So: add the FSA sink now (buffered), upgrade to streaming under R2.

## D18. Naming — `events` and "materialize" (Decision, mechanical)

**Comments:**
- on `events`: *"call these `dicomEvents` or `dicomEventStream` … make it clear these aren't
  events that have already happened, like UI events."*
- on "One listener **materializes** all sources": *"naturalizes?"*

**Decision:**
- Rename the bare `events` identifier in public API examples, docs, and local variables to
  **`dicomEventStream`** (or `dicomEvents` for a plain array). The class is already
  `DicomEventStream`; this aligns the ergonomic naming and removes the UI-event ambiguity.
  Mechanical, low risk — docs + example snippets, no behavior change.
- Use **"naturalize"** for the naturalization listener wherever the proposal said "materialize."
  Reserve "materialize" only for the sink-agnostic sense (apply *a* policy to produce *some*
  object) if that generic sense is even still needed; in the §6.3 sentence it means
  naturalization specifically, so it becomes "naturalizes."

## D19. The oracle and the corpus (resolves proposal §12.4 "what is the oracle")

**Comments:**
- on the oracle question: Steve started an independent cross-toolkit DICOM comparison
  experiment — **`github.com/pieper/dicompare`** — *"It seems feasible."*
- on "Stand up the regression suite": *"a huge part of what we need … use the standard plus
  this corpus to define a schema for what we mean by 'supported' in a 1.0 release."*
- on the corpus: *"start with IDC first, but we'll need to … make phantom data that matches
  known weird data we can't put in the suite due to PHI. Maybe an automated phantom generator."*

**Draft answer:** This resolves the §12.4 oracle question in the intended direction — parity is
measured against an **independent parser, not dcmjs's own current output**, so current bugs are
not pinned as the contract. Concretely:
- **Oracle:** adopt `pieper/dicompare` as the cross-toolkit comparison harness for the slice G
  equivalence suite. Action item: evaluate its maturity and coverage before wiring it into the
  gate; it defines "same" across toolkits, which is exactly the independent reference §31 wants.
- **Corpus:** start from **IDC** public data (already de-identified, citable). For the weird
  real-world cases that can't be shared (PHI), build an **automated phantom generator** that
  reproduces the *structural* anomaly (bad VM, missing private creator, non-canonical encoding)
  on synthetic pixel/identity data — the fixture carries the pathology without the PHI.
- **Feeds D22:** "standard + corpus → schema for 'supported'" is the same schema as D22; the
  corpus is where the schema's conformance rules are exercised.
This is slice **G** work (cross-source equivalence suite) plus a new phantom-generator tool;
it should get its own planning pass before the fallback-removal gate depends on it.

**Correction (2026-07-03, graph-grounded):** the proposal's appendix fixture-gap list ("missing
fixtures: big endian, native enhanced multi-frame, BulkDataURI, DICOMweb JSON") is **partly
stale** for this repo. Already present in the corpus: **big-endian** fixtures
(`packages/parser/testImages/CT1_UNC.explicit_big_endian.dcm` + DCMTK-converted endianness
variants), the **dclunie deflate** suite (`testImages/deflate/`), and **encapsulated
single/multi-frame** JPEG/JPEG-LS/RLE fixtures with BOT variants (`testImages/encapsulated/`).
The true remaining gaps are narrower: **native (uncompressed) enhanced multi-frame**,
**BulkDataURI**, and **DICOMweb JSON response** fixtures. Corpus planning should fill those
three, not rebuild what exists.

## D20. A conformance / validation layer — NEW SCOPE (proposed slice H)

**Comment:** on the regression suite — *"a validation layer that can issue warning or error
when it sees any data that doesn't conform. Ideally it should suggest sharing the offending
data if the user can, or provide an anonymized description of the non-conformance that can be
logged in an issue."*

**Draft answer:** This is new scope beyond the proposal's five components, but it fits the
architecture cleanly: **a validator is just another listener over the event stream** (the D19
hub model — one more sink). It checks each element against the D22 schema + the DICOM standard
and emits **structured diagnostics** (warning/error) rather than throwing. It reuses the
cardinality-violation diagnostic channel already built in **D12** (`listener.violations`),
generalized from "VM violations" to "any non-conformance." The "suggest sharing / anonymized
non-conformance description" feature is a **diagnostic serializer** that emits the offending
element's structure (tag, VR, VM, what rule failed) with values redacted — safe to paste into
an issue. Recommend scoping this as a dedicated slice **H (conformance validation)**, after the
core, depending on D22's schema. Not in the current A–G/D1 line.

## D21. Normalization — NEW SCOPE, opt-in, out of 1.0 core (proposed slice I)

**Comment:** on "documented contract" — *"We should also discuss if we want to take on the
Normalization part of dcmjs … handling all the non-standard things that we know are wrong with
specific types of data (e.g. moving data from private tags into the tags the standard defines)."*

**Draft answer:** Keep it **out of the 1.0 core, offer it as an explicit opt-in layer.** The
reasoning is central to the whole proposal: the architecture is built on loss-**preservation**
(carry every value faithfully, output depends only on the data). Normalization is loss-
**correction** — it *deliberately rewrites* data (private → standard tags, fixing known-wrong
values). Folding correction into the naturalizer would reintroduce exactly the **§3.1
source-dependent-output drift** we are eliminating: two instances with the same data would
naturalize differently depending on which quirks the normalizer recognized.

The right shape is a **normalizing transform over the event stream** — another hub participant
(D19), sitting *between* a source and the naturalized sink, applied only when the caller asks
for it and **separately versioned** (its rule catalog changes independently of the contract).
So: preserve first (1.0 core), normalize as an opt-in transform (its own sub-project, slice
**I**, with a documented, testable rule catalog). This also keeps the "raw is recoverable"
guarantee — a normalized value can always point back at what it corrected.

## D22. A machine-readable schema for the contract (component-1 deliverable)

**Comments:**
- on "documented contract": *"I think we're going to want to make a schema for this too."*
- on §10 "supported": *"use the standard plus this corpus to define a schema for what we mean
  by 'supported'."*

**Draft answer:** Complement the prose spec (component 1) with a **machine-readable schema** of
the naturalized representation, not just narrative. Two artifacts, one source of truth:
- **Generated TypeScript types** — the proposal already gestures at this (`PatientID: string`,
  `ImageType: string[]`); the shape is a documented function of VR + VM, so the types are
  generable from the dictionary + the cardinality rules.
- **A JSON-Schema-style conformance schema** for validation — the definition of "supported"
  that slice H (D20) checks against and the D19 corpus exercises.
Both derive from the same VR/VM cardinality rules in §5/§12, so they can't drift from each other
or from the contract. Recommend making the schema an explicit deliverable of component 1
alongside the written spec.

## D23. Does streaming ever force the whole header into memory? (answers proposal §4.2 probe)

**Comment:** on "Read without holding the whole thing in memory" — *"Even for a WSI the header
almost always fits in memory … Do you know of any cases where this doesn't hold? … whether there
are things in the standard where you can't know how to process the first part of the header
until you see the last part, forcing the whole header in memory."*

**Draft answer:** For **Part 10**, effectively **no** — nothing forces whole-header buffering:
- Elements are stored in **ascending tag order** within a dataset, and **File Meta Information
  (group 0002) comes first**, so the **transfer syntax is known before the main dataset** — you
  never need the end to decode the beginning.
- **Specific Character Set** (0008,0005) precedes the string elements it governs; **private
  creators** (gggg,0010–00FF) precede their data block (gggg,xx10…) by tag order, so
  private-tag VR/meaning is resolvable as you stream — no look-back.
- **Undefined-length** sequences and encapsulated pixel data don't need their length up front;
  they stream item-by-item to a delimiter. The **Basic Offset Table** sits at the *start* of
  encapsulated pixel data, so frame offsets arrive before frames.
- **Enhanced/multi-frame framing** — Shared (5200,9229) and Per-Frame (5200,9230) Functional
  Groups Sequences both sort **before** Pixel Data (7FE0,0010), so the framing is fully known
  before any pixel bytes. (This is also the answer to the "progressive SEG" comment — see D24.)

The **one genuine look-ahead case is DICOMweb JSON**, not Part 10: a JSON object is **unordered**,
so a private data element can appear *before* its private creator in document order. There, the
private-creator link needs the enclosing item buffered until the creator is seen — but that is
**bounded by the enclosing item**, not the whole header, and only affects the JSON source.

**Bottom line for the proposal:** Steve is right that the header fits in memory in practice; the
streaming benefit is **not** about header size. Its real payoffs are (a) not materializing huge
**pixel/multi-frame** payloads, and (b) starting downstream work **before the last byte arrives**
over a slow network — plus progressive *writes* (SEG/anonymize) at constant memory. The §4.2
bullet should be reframed away from "header too big for memory" toward those. No Part 10 ordering
case forces whole-header buffering.

## D24. "progressive SEG" example is unclear — reword (proposal §4.2 / §6.5)

**Comment:** on "progressive SEG" — *"It's not clear what this is. SEG headers need to know how
to populate their functional groups even if the actual pixel data comes later."*

**Draft answer:** Steve's own sentence is the resolution, and it's consistent with D23: the SEG
**header, including its functional groups, is fully known and emitted first** (functional-group
sequences precede Pixel Data in tag order), and then **segment frames stream out afterward** as
they are computed or fetched — the writer never has to hold all frames in memory at once. Reword
the example to say exactly that: *"a SEG whose per-frame groups are known up front but whose
frames are computed one at a time can emit its header, then stream frame pixel data
progressively."* The point is progressive **pixel emission with a fully-formed header**, not a
progressively-discovered header.

## D25. Integrate `clintools/dicom-curate`? (concrete home for D20/D21; grounded in source)

**Question (raised by the user):** Does integrating `github.com/clintools/dicom-curate` make sense?

**Correction of first-pass claims:** an initial README skim reported dicom-curate "does NOT use
dcmjs," ships "custom DICOM parsing," a bespoke "in-memory DICOM JSON," and "removes most File
Meta Information." **Reading the source, all four are false.** It has no parser of its own —
it is a **dcmjs consumer** (`"dcmjs": "^0.51.1"`).

**What it actually is (from source):** a full dcmjs read-modify-write curation/de-identification
pipeline. Path (`curateOne.ts` → `collectMappings.ts` → `curateDict.ts` → `mapMetaheader.ts`):
1. dcmjs **async** `reader.readFile(...)` → `new dcmjs.data.DicomDict(reader.meta)` + dict.
2. `DicomMetaDictionary.naturalizeDataset(dict)` → the naturalized object (`TNaturalData`).
3. Mutate that object with lodash `_get`/`_set`/`_unset` — `delete`/`replace` per a
   `TCurationSpecification`, applying **PS3.15E** de-id profiles + CSV identity mapping + UID
   hashing (`deidentifyPS315E.ts`, `hashUid.ts`).
4. `DicomMetaDictionary.denaturalizeDataset(naturalData)` → dict, then **manually restore
   quarantined private tags directly to the dict** (denaturalize drops private-creator linkage).
5. `mapMetaheader(meta, ...)` naturalizes/denaturalizes **group-0002 separately** with a
   constrained mapping — it keeps FMI, does not strip it.
6. `new DicomDict(...).write(...)` → bytes → streamed to a sink (Node fs / FSA / HTTP / S3).

**Why this reframes the integration question:** it is not "adopt a competing parser" (there is
none). dicom-curate is **already the exact round-trip 1.0 rebuilds, pinned to legacy dcmjs
0.51.1 — so it currently encodes, and works around, the precise defects the proposal fixes:**

| dicom-curate workaround (today) | Proposal defect | Fixed by |
|---|---|---|
| lodash `_get`/`_set` over `naturalizeDataset` output | §3.2 proxy + VM-collapse shape (ImageType → scalar) | **D1** naturalized model (VM cardinality, no proxies) |
| manual **quarantine + restore of private tags** to the dict | §3.3 private-creator loss on denaturalize | **D2/D13** private-tag grouping |
| read-modify-write over values that lost `_rawValue` | §3.3 precision/raw drop → untouched numbers silently reformatted on write | **D14** raw retention |
| separate hard-coded metaheader naturalize/denaturalize | FMI is a constrained sub-format | **D5** FMI bracketed sub-stream |
| its whole value prop = "change a few tags, keep the rest" | **§12.4 / D16** "unedited parts unchanged" | **D16** per-element passthrough + **D14** |

That last row is the crux: dicom-curate's entire purpose is Steve's D16 requirement, and today
it **cannot** fully honor it (naturalize drops raw, denaturalize re-encodes untouched elements).
So D16+D14 is not just nice-to-have for it — it is what makes it correct.

**Draft answer — yes, integrate, with a changed condition.** The earlier caveat ("bring it in as
a transform, not a second parser") is now moot — it already speaks dcmjs. The real integration is:
- **Adopt it as the canonical curation / de-identification layer** — its `TCurationSpecification`
  language + PS3.15E profiles + CSV mapping + UID hashing **are** the D21 (slice I) opt-in
  "normalization/correction transform with a documented, versioned rule catalog." We don't build
  that from scratch; we adopt it. (Note: de-id is loss *removal*, the D21 category — correctly
  opt-in and outside the preserve-first core.)
- **Its validation rules + PS3.15E conformance** seed the D20 (slice H) validator listener.
- **Migrate it off legacy `naturalizeDataset`/`denaturalizeDataset` + `DicomDict.write` onto the
  event-stream sources/sinks and the D1 model.** When it does, the four workarounds above
  (private-tag quarantine, raw-value drift, separate metaheader handling, proxy `_get`/`_set`
  fragility) are **absorbed by the contract** and deleted from dicom-curate.
- This makes it the **flagship real-world consumer** for the slice F compat wrappers (R1) and the
  slice G equivalence suite — its behavior-diff across the migration is a live proof the new
  naturalized shape is adoptable, and it pairs with Steve's `dicompare` oracle (D19) and IDC
  corpus as one clinical-tools verification trio.

**Superseded verification items** (from the pre-source list): #1 "its in-memory shape" — resolved:
it's the dcmjs naturalized object + `DicomDict`, standard, no adapter needed. #2 "FMI handling" —
resolved: it maps, not strips, group-0002. Remaining checks: **license/governance** compat
(clintools ecosystem, same as dicompare — a plus); **maturity/coupling** (still pre-1.0, "APIs may
change") — depend on its rule *semantics*, migrate the engine onto the new contract rather than
pinning to its current API; **don't-duplicate** — it should supersede dcmjs's existing
`data/anonymizer`, not stack a third de-id path.

**Not yet binding** — this proposes dicom-curate as the concrete engine behind slices H and I,
which are themselves still-unconfirmed new scope (D20/D21). Confirm those, then this follows.
*(Confirmed 2026-07-03 — see D26.)*

## D26. Scope confirmation — H and I are in; implementation order (user decision, 2026-07-03)

**Question:** Are slices H and I confirmed 1.0 scope, and where does implementation start?

**Decision:**
- **H and I are in scope.** Rationale (user): both are *optional sinks* over the event stream —
  they add no risk to the preserve-first core, so there is no reason to hold them pending
  review bandwidth. Steve is a collaborator and subject-matter expert, but he is busy and
  cannot be expected to drive the entire specification; the working mode is **draft on a
  separate branch and proceed**, folding his feedback in as review rounds arrive rather than
  blocking on it. D20/D21/D25 are now binding.
- **Implementation starts with D22 (the machine-readable schema)** — the shared prerequisite
  gating both H and I, the proposal's own "controlling document" step, and the one item that
  needs nothing external. D18's mechanical rename can ride along.
- **Branch:** `dcmjs-unified-schema` (off `dcmjs-unified-comments`).
- Still tracked as open inputs, not blockers: Steve's confirmation of the D16 reading
  (element/body-level passthrough), and the dicom-curate license/governance check before
  slice I consumes its rule engine.

## D27. D22 design decisions — rule catalog as the one source of truth (2026-07-03)

Full design: `docs/superpowers/specs/2026-07-03-d22-naturalized-schema-design.md`.
Four decisions, each chosen from explicit options (user-selected):

1. **TS granularity — one flat interface.** A single generated `NaturalizedDataset` with all
   5,165 standard keywords as optional, VM-correctly-typed properties. Rejected: per-VR
   branded types (fights plain-object semantics); IOD-aware per-SOP-class types (needs
   Part 3 tables the packed dictionary doesn't have — can layer on later).
2. **Schema subject — rule catalog as source of truth.** The normative artifact is a
   machine-readable rule catalog (tag → VR/VM + shared per-VR format table + envelope
   rules), generated from the packed dictionary; the `.d.ts` and a literal JSON-Schema
   document are derived projections; slice H's validator consumes the catalog directly,
   streaming. Rejected: literal JSON Schema as primary (can't express VM patterns like
   `3-3n` or original-encoding length caps without custom keywords, and is built for
   materialized-document validation, not element-by-element streams); two independently
   generated artifacts (two encodings of the same rules = the drift D22 exists to prevent).
3. **Rule depth — VR-format depth.** Structural (VR/VM/shape) plus per-VR Part 5 value
   constraints (DA/TM/DT patterns, IS ≤ 12 / DS ≤ 16, UI charset, AS format). Rejected:
   structural-only (validator couldn't flag malformed dates/UIDs); defined-terms depth
   (needs Part 3/16 acquisition — out of scope).
4. **Distribution — `dcmjs/schema` subpath export.** Honest opt-in; dcmjs's first published
   types. Rejected: top-level `"types"` field (falsely implies the whole API is typed;
   collides with consumers' hand-written `declare module 'dcmjs'` — dicom-curate has one);
   repo-only artifacts (no consumer benefit).

Testing contract: code-agreement gate (NaturalizedListener output over the fixture corpus
must satisfy the catalog — the seed of slice H), tsc gate, determinism gate (regenerate →
diff-clean in CI). Documentation deliverables include the docs guide page **and** a PR
description that documents the public API surface (user requirement).

## D28. Lazy core deprecated — event stream is the strategic surface (stakeholder decision, 2026-08-02)

**Decision (stakeholder, Abigail ↔ Jarkko loop):** "We don't want the lazy parser —
the event stream gets ~90% of the benefit; the remaining 10% isn't justified by cost."

**What changes:** `DicomMessage.defaultCore` flips back to `"eager"`; the lazy core
(`core:"lazy"` / `DCMJS_CORE=lazy`) is deprecated with a one-time warning and
`src/lazy/LazyDicomReader.js` (~1,255 loc) plus the lazy test suites (~1,594 loc)
are deleted in the NEXT release (soft landing: one release of escape hatch). The
**byte-identity passthrough write guarantee is withdrawn** — it lives only in lazy
entries (`_sourceSpan`/`_dirty`); eager writes are always correct DICOM, re-encoded.

**What does NOT change:** the event stream (`fromPart10`/`fromPart10Stream`/
`DicomEventStream`), shared `decodeCore`, `SplitDataView`, the backpatch writer, and
the dictionary/schema stack — all strategic, all untouched. The eager loop
(`_read`/`_readTag`) is the engine of record again, which also un-blocks nothing:
AsyncDicomReader's `_read` dependency stops being a deletion blocker because the
deletion it blocked is cancelled.

**Inverts:** R2 ("lazy bridge is the default"), R7's deletion list ("delete the eager
loop"), and the R4 passthrough engine's long-term status. See the roadmap banner.

**Rationale:** cost/benefit — the lazy core's remaining exclusive value
(byte-identical unmodified saves, lazy-access read speed) does not pay for a second
buffered read engine's maintenance: dual-core test runs, divergence ledgers, the
`DicomMessage ⇄ LazyDicomReader` cycle (AD-4), and reviewer cognitive load.
Honeycomb's workload is read-heavy; correct-but-re-encoded writes are acceptable.
