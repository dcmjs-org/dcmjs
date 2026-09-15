# Task K7 Report — AsyncDicomReader re-platform assessment + Phase 2 docs

**Branch:** event-stream-source
**Baseline commit:** 8efdb2a (K6 fix round 1)
**Outcome:** Part A DEFERRED (clean, evidenced, no src changes) + Part B docs landed

---

## Part A — Adapter assessment (DEFERRED)

### Decision

The AsyncDicomReader re-platform onto `fromPart10Stream` is **deferred to 1.x**. No source
files were modified. The decision is based on empirical analysis of the exact breakage
points the existing gate tests (async-data.test.js, information-filter.test.js) would expose.

### Specific breakage points

**Breakage 1 — Uncompressed pixel data frame splitting (FATAL)**

`fromPart10Stream` delivers uncompressed pixel data via `emitValues` as:
```
startElement("7FE00010", { vr: "OW", length: N })
startBinary({ encapsulated: false })
binaryFragment(wholePixelBuffer)   // one call for the full blob
endBinary()
endElement()
```

`AsyncDicomReader.readUncompressed()` splits the same blob into per-frame arrays:
```js
for (let frameNumber = 0; frameNumber < numberOfFrames; frameNumber++) {
    listener.startObject([]);   // creates a frame array
    await this._emitSplitValues(frameLength);  // delivers one chunk per frame slice
    listener.pop();
}
```
using `listener.information.numberOfFrames`, `rows`, `columns`, `bitsAllocated`, and
`samplesPerPixel` (all populated by the `createInformationFilter` intercepting `addTag`/`value`).

The test in `async-data.test.js` asserts:
```js
const frames = dict[TagHex.PixelData].Value;
expect(Array.isArray(frames)).toBe(true);     // outer array of frames
expect(frames.length).toBe(1);                // one frame
expect(Array.isArray(frames[0])).toBe(true);  // each frame is an array of chunks
expect(frames[0].length).toBe(1);
expect(frames[0][0].byteLength).toBe(512 * 512 * 2);
```

A thin shim receiving `startBinary/binaryFragment/endBinary` from `fromPart10Stream`
would produce `Value = [ArrayBuffer]`, not `Value = [[ArrayBuffer]]`. To reproduce the
nested array, the shim would need to:
1. Buffer the complete pixel blob (defeating streaming memory savings)
2. Read frame geometry from `listener.information` (which must itself be populated from
   15-verb events, not 4-verb events)
3. Re-split the blob into per-frame arrays using identical logic to `readUncompressed`

This is NOT a thin adapter — it requires reimplementing a major feature.

**Breakage 2 — Compressed pixel data frame assembly (FATAL)**

`fromPart10Stream.emitEncapsulated()` streams fragments flat:
```
startElement("7FE00010", { vr: "OB", length: 0xFFFFFFFF })
startBinary({ encapsulated: true })
binaryFragment(fragment1)
binaryFragment(fragment2)
...
endBinary()
endElement()
```

`AsyncDicomReader.readCompressed()` assembles frames from fragments using Basic Offset
Table offsets, delivering:
```
listener.startObject(frameArray)   // start frame
listener.value(fragment)           // one value per fragment in frame
listener.pop()                     // close frame
```

The shim would need to re-implement the BOT offset parsing + fragment accumulation to
reproduce the per-frame grouping.

**Breakage 3 — Chunk-feeding interface (BRIDGEABLE but complex)**

The public API requires:
```js
reader.stream.addBuffer(chunk);   // push-based
reader.stream.setComplete();
reader.stream.fromAsyncStream(nodeStream);
```
while `fromPart10Stream` requires an `AsyncIterable` (pull-based). Bridging is possible
via an internal chunk queue and async generator, but requires exposing queue state.
Not fatal on its own, but adds complexity to an already non-thin adapter.

### Why these are the specific friction points the brief warned about

The brief listed: "the legacy listener's addTag/startObject/value/pop contract, the
information-filter's numberOfFrames/rows/cols expectations, compressed-stream handling
AsyncDicomReader explicitly lacks."

The frame/row/col expectations (#2) and compressed-stream (#3) are exactly what broke.
The 15→4 verb shim requires semantic reconstruction of frame-level structure that
`AsyncDicomReader` implements as a first-class feature; this is not a vocabulary
translation problem.

### No src changes made

`src/AsyncDicomReader.js` and all other source files are untouched. The diff for this
commit is docs-only.

---

## Part B — Docs (DONE)

Three files updated:

### 1. `CLAUDE_REFACTOR_PLAN.md` — slice K status

Slice K updated from "APPROVED 2026-07-06 — queued behind J." to:

> **DONE** — `src/eventStream/fromPart10Stream.js` shipped (stages K1–K6): chunked
> AsyncIterable/ReadableStream input, clearBuffers bounded memory, incremental FMI,
> full body element loop (defined-length/undefined-length/SQ/deflate/encapsulated),
> 29-fixture corpus equivalence, bounded-memory + backpressure + truncation gates,
> 1422 tests both cores. R6.7 (AsyncDicomReader re-platform): **deferred to 1.x** —
> pixel-data frame-splitting and compressed-frame-assembly semantics are not reproducible
> by a thin shim; deferred cleanly with no src changes; see task-K7-report.md.

### 2. `packages/docs/docs/development/roadmap.md` — R6 section

- Status table: R6 changed from "PARTIAL — scoped fixes only" to "DONE (streaming source
  `fromPart10Stream` complete, stages K1–K6); AsyncDicomReader re-platform deferred to 1.x"
- "Where we are" paragraph: updated to reflect slice K completion and K7 deferral
- R6 section: completely rewritten with two subsections:
  - "What shipped: `fromPart10Stream`" — describes the architecture, bounded memory,
    deflate, corpus equivalence, backpressure, truncation
  - "What remains deferred: AsyncDicomReader re-platform (K7 / R6.7)" — names the two
    specific breakage points (frame splitting, frame assembly)
- R8 item #7: changed from `[ ]` NOT DONE to `[x]` DONE for the streaming source,
  with a note that K7/R6.7 remains deferred
- 1.x backlog: AsyncDicomReader re-platform updated with specific breakage description

### 3. `packages/docs/docs/architecture/streaming.md` — rewritten

Previous content described only `AsyncDicomReader`. New content covers both paths:

1. **`fromPart10Stream` section** — accepted inputs, ASCII architecture diagram showing
   all 5 phases (preamble detection, incremental FMI, FMI event emission, body element
   loop, deflate relay), decision D-C explanation, bounded memory mechanism, backpressure
   contract, corpus equivalence + DELTA-A
2. **`AsyncDicomReader` section** — retained for correctness; updated with a note that
   re-platforming onto `fromPart10Stream` is non-trivial and lists the two specific
   breakage points (frame splitting and frame assembly)

---

## Gate outputs

| Command | Tests | Pass | Fail |
|---------|-------|------|------|
| `pnpm exec jest test/async-data.test.js test/sync-async-parser-equivalency.test.js test/information-filter.test.js` | 26 | 26 | 0 |
| `pnpm exec jest test/eventStream` | 423 | 423 | 0 |
| `pnpm test` | 1422 | 1422 | 0 |
| `DCMJS_CORE=eager pnpm test` | 1422 | 1422 | 0 |

All gates green. No regressions.

---

## Concerns

None. The deferral is clean:
- No partial src edits to revert
- All existing tests pass unchanged
- The two breakage points are specific and evidence-based (not speculative)
- A clear path forward exists for 1.x (options: emit per-frame events from
  `fromPart10Stream`, add a frame-assembly adapter layer, or write a comprehensive
  shim that accepts the additional complexity)
