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

## Open code fixes — engine files (fix on release/1.0-beta-core, pre-move)

| # | Sev | File | Finding | Master hotfix? |
|---|-----|------|---------|----------------|
| 1 | HIGH | BufferStream.js | Node Buffer with non-zero byteOffset no longer parses | **Yes** |
| 3 | HIGH | ValueRepresentation.js | UV element with null value throws on write | Partial — verify |
| 4 | HIGH | DicomMetaDictionary.js | Private-tag fallback builds unwritable element | No (new code) |
| 24 | MED | DicomMessage.js | Meta group length check misses overstated length | Verify |
| 25 | MED | AsyncDicomReader.js | Async reader outside the xs contract | **Yes** |
| 27 | LOW | SplitDataView.js | getBufferMemoryInfo counts backing ArrayBuffer | No |
| 28 | LOW | BufferStream.js | concat advances write position past copy | **Yes** (latent) |
| 32 | MED | DicomMetaDictionary.js | naturalizeDataset mutates global nameMap | No |

## Open code fixes — event stream (fix before/with wave-4 slices)

| # | Sev | File | Finding |
|---|-----|------|---------|
| 5 | HIGH | StreamingPart10Writer.js | Self-built headers always little-endian |
| 6 | HIGH | fromPart10Stream.js | Listener error deadlocks deflate relay (partial fix on v2) |
| 7 | HIGH | fromPart10Stream.js | Source error dropped; truncated stream reads as clean end (partial) |
| 11 | MED | StreamingPart10Writer.js | Whole backing buffer stored for defined-length fragment |
| 13 | MED | asyncIterator.js | ~~break out of async iterable leaks the producer~~ **Fixed in #533** — `return()` cancels the producer with `EventIterationCancelled` |
| 14 | MED | api.js | Video factory unhandled rejection (may be trimmed out of 1.0 core api) |
| 22 | MED | test: StreamingPart10Writer.test.js | Helper reads whole Node buffer pool (use readFileAsArrayBuffer) |
| 23 | MED | test: streamEquivalence.test.js | 1-byte chunk gate never runs; Windows path separators |

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
