# Routing the 33 review findings from PR #512

> Tracked as this file on the `1.0-beta` branch. RELEASE_PLAN.md §8 describes
> a GitHub checklist issue; for now the checklist lives here instead (decided
> 2026-09-30). Triage against `v2.0-development` performed 2026-09-29.
> Review map: the user-attachment link in RELEASE_PLAN.md.

Each finding below gets its own small PR on `release/1.0-beta-core` with a
regression test, before the file it touches moves. Master-applicable findings
also get a 0.52.x hotfix PR.

## Already resolved on the rewrite branch (verify + regression test only)

| # | Sev | Finding | Status | Applies to master |
|---|-----|---------|--------|-------------------|
| 2 | HIGH | cleanTags empties whole diagnostic sequences | **Improvement, keep** (per review map verdict) — document + opt-in filter | Yes (behavior differs; document) |
| 12 | MED | Feed loop keeps buffering after parse failure | **Fixed on v2** (backpressure throttle + K5b test) | No |
| 26 | MED | Private creator in reserved range reads as UN | **Improvement, keep** — fixed per PS3.5 7.8.1; unskip issue356 test | No (master accepts 0x0001+; document) |
| 33 | MED | uid() format change | **Fixed on v2** (RFC 4122–derived, ≤39 digits) — needs documentation entry | No (master's 44-char format was non-compliant) |

## Retired by the lazy-core removal

| # | Sev | Finding |
|---|-----|---------|
| 20 | MED | Passthrough misses entry moved inside one sequence (LazyDicomReader) |
| 21 | MED | Malformed fragment stream poisons every encapsulated element (LazyDicomReader) |

## Documentation findings (land with the docs package, not code PRs)

| # | Sev | Finding |
|---|-----|---------|
| 29 | HIGH | Migration guide documents the lazy core as the default |
| 30 | HIGH | Migration guide promises a byte-identity guarantee that is gone |
| 31 | MED | Guide claims naturalization is unchanged from 0.x (three changes exist) |

## Engine-file fixes — all landed on release/1.0-beta-core 2026-09-30

Master verdicts below were verified against `origin/master` during the fixes
(not just triaged). Hotfix PRs for the master-applicable ones are still to do.

| # | Sev | File | Finding | Fixed in | Master hotfix? |
|---|-----|------|---------|----------|----------------|
| 1 | HIGH | BufferStream.js | Node Buffer with non-zero byteOffset no longer parses | **#547** | **Yes, verified** — on master the Buffer `.offset` seed cancels out, but plain `Uint8Array` views at non-zero byteOffset are live-broken |
| 3 | HIGH | ValueRepresentation.js | UV element with null value throws on write | **#551** | **Yes, partial** — master's UV throws on `[null]` and Number values (scalar null already wrote zero-length) |
| 4 | HIGH | DicomMetaDictionary.js | Private-tag fallback builds unwritable element | **#546** | No, verified — master has no fallback (drops silently); the unwritable shape was dev-branch-only |
| 24 | MED | DicomMessage.js | Meta group length check misses overstated length | **#549** | **Yes, verified** — identical unguarded window on master; quiet mis-frame reproduced |
| 25 | MED | AsyncDicomReader.js | Async reader outside the xs contract | **#544** | **Yes, verified** — identical code verbatim on master (incl. the dead inverted branch) |
| 27 | LOW | SplitDataView.js | getBufferMemoryInfo counts backing ArrayBuffer | **#545** | No in effect — lines exist verbatim on master but are unreachable (no narrow-view producer); fixed ahead of the zero-copy wave |
| 28 | LOW | BufferStream.js | concat advances write position past copy | **#550** | **Yes, latent, verified** — identical line on master, unreachable by current callers |
| 32 | MED | DicomMetaDictionary.js | naturalizeDataset mutates global nameMap | **#548** | No, verified — master's registerTag has the same asymmetry but naturalizeDataset never writes the nameMap |

## Event-stream fixes — all landed with the writers wave 2026-09-30

The writers wave ported the writer sinks from v2 with these findings fixed
in the port: #552 (test-infra: downloadToFile fails fast on bad fixture
downloads), #553 (Part10Writer + DicomWebJsonWriter), #554 (findings 6+7),
#555 (StreamingPart10Writer, findings 5+11+22), #556 (equivalence bank,
finding 23), #557 (DicomEventStream facade, finding 14 by omission).

| # | Sev | File | Finding | Fixed in |
|---|-----|------|---------|----------|
| 5 | HIGH | StreamingPart10Writer.js | Self-built headers always little-endian | **#555** — endianness derived from the body syntax; FMI stays little-endian |
| 6 | HIGH | fromPart10Stream.js | Listener error deadlocks deflate relay | **#554** — `bodyFailed` deferred raced in the relay throttle |
| 7 | HIGH | fromPart10Stream.js | Source error dropped; truncated stream reads as clean end | **#554** — feedError checked before endDataSet; source error wins in the body catch |
| 11 | MED | StreamingPart10Writer.js | Whole backing buffer stored for defined-length fragment | **#555** — fragment views sliced to their own span |
| 13 | MED | asyncIterator.js | break out of async iterable leaks the producer | **#533** — `return()` cancels the producer with `EventIterationCancelled` |
| 14 | MED | api.js | Video factory unhandled rejection | **#557, by omission** — video factories trimmed from the core facade; media-wave fix shape recorded in the PR body (lazy sourcePromise in `_run` or no-op catch) |
| 22 | MED | test: StreamingPart10Writer.test.js | Helper reads whole Node buffer pool | **#555** — helper slices the view's own byte range |
| 23 | MED | test: streamEquivalence.test.js | 1-byte chunk gate never runs; Windows path separators | **#556** — posix-normalized paths plus a non-empty gate assertion |

## Open code fixes — image/FHIR (fix with their package waves)

| # | Sev | File | Finding |
|---|-----|------|---------|
| 8 | HIGH | fhir/documentReference.js | Mapper loses every encapsulated document (InlineBinary shape) |
| 9 | HIGH | image/jpegInfo.js | Reads past end of truncated file |
| 10 | HIGH | image/buildImageDataset.js | Encapsulated multi-frame omits NumberOfFrames |
| 15 | MED | image/mp4Info.js | Malformed stts box blocks thread, fabricates frame count |
| 16 | MED | fhir/documentReference.js | Pad-trim strips a real zero byte |
| 17 | MED | fhir/imagingStudy.js | Missing SOPClassUID becomes fabricated CT UID |
| 18 | MED | fhir/imagingStudy.js | Series with no UID becomes null; all merge |
| 19 | MED | fhir/helpers.js | Text-only HumanName erases the patient name |

## fromPart10Stream and the 500-line budget (resolved)

`fromPart10Stream.js` is 1,468 lines and its test file is 2,307 — it could
not meet the ~500-line PR budget. The budget-waiver route was chosen and
granted: the reader landed whole as PR #538, with the corpus gate comparing
every vendored test image element-for-element against the eager reader.

Findings 6 and 7 (deflate relay deadlock, dropped source error) have partial
fixes on v2 and must be completed with the writers wave.

## Also noteworthy (outside the 33)

- GitHub reports 29 dependabot vulnerabilities (14 high) on **master**. The
  staging branches fixed the audit via pnpm-workspace overrides in PR #521 —
  the same change is a candidate 0.52.x hotfix (master's pins in the
  package.json `pnpm` field are silently ignored by pnpm 11).
