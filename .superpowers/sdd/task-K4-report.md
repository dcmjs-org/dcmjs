# Stage K4 Report — Undefined-length structures stream natively; chunk release live

**Branch**: event-stream-source
**Commit**: `4b3968d` — `feat(eventStream): fromPart10Stream streams undefined-length structures natively; chunk release live (slice K stage 4)`
**Split**: single commit (the diff stayed manageable — one file rewritten, one export removed, tests extended; the sanctioned 4a/4b split was not needed).

---

## Baseline

| Core | Tests before K4 | Tests after K4 |
|------|-----------------|----------------|
| default (`@dcmjs/parser`) | 1282 green, 0 skipped | **1298 green, 0 skipped** |
| eager (`DCMJS_CORE=eager`) | 1282 green, 0 skipped | **1298 green, 0 skipped** |

+16 new tests (K4 group). `pnpm exec jest test/eventStream` → 299/299.

---

## What streams natively now (per corpus phase)

Before K4, `options.onPhase` reported `tailFallback` for **21 of 26** corpus fixtures.
After K4 **zero** fixtures tail-fall-back — every non-deflate fixture reports `native`
(Test 17 asserts this over the whole corpus). Enumerated by phase-of-driver:

### Encapsulated pixel-data fragment streaming (`emitEncapsulated`)
All encapsulated fixtures now stream fragment-by-fragment (BOT skipped):
- `encapsulated/single-frame/CT1_UNC.{not_,}fragmented_{no_,}bot_jpeg_ls.80.dcm`
- `encapsulated/multi-frame/CT0012.{not_,}fragmented_{no_,}bot_{jpeg_ls,jpeg_baseline,jpeg_lossless,rle}.*.dcm`
- `encapsulated/multi-frame/IM00001.fragmented_no_bot_jpeg_baseline.50.dcm`
- `test/sample-op.dcm` (encapsulated pixel data + undefined-length SQ)
- BOT counts observed: 0 (empty first item), 1, and 2 offsets — all handled by
  reading the first (BOT) item header and skipping its bytes, matching buffered
  `fromPart10` which stores the BOT in `element.basicOffsetTable` and never emits it.

### Undefined-length SQ / items (`emitSequence` + `parseSqItems`/`parseItemElements`)
Top-level and arbitrarily-nested undefined-length sequences:
- `test/sample-dicom.dcm` (7 undefined SQ, incl. nested + a zero-length SQ)
- `test/cine-test.dcm`, `test/invalid-vr-length-test.dcm` (deep nesting: `52009229 →
  52009230 → 00209111 → 00209113/00289132`, undefined inside undefined)
- `encapsulated/multi-frame/CT0012.explicit_little_endian.dcm` (24 undefined SQ)
- `encapsulated/multi-frame/IM00001.implicit_little_endian.dcm` (undefined SQ in
  implicit LE, dictionary-resolved)
- All three `CT1_UNC.{ebe,ele,ile}` fixtures remained `native` (no regression).

### Undefined-length non-SQ "eagerWindow" leaf (`emitUndefinedLeaf`)
**Zero corpus fixtures hit this class** (a full recursive scan of all 26 fixtures via
`classifyElement` found only `sequence` and `encapsulated`). It is exercised only by
the synthesized J4a UN fixture (Test 22).

---

## EventBuffer keep/delete decision + rationale

**Decision: the tail-fallback EventBuffer machinery is DELETED; a slim per-subtree
EventBuffer is RETAINED for undefined-length SQ/items only.**

The K3 EventBuffer existed for *tail-fallback atomicity* (discard-and-restart a
top-level SQ on `TailFallbackSignal`). That role is gone — nothing can fall back
mid-subtree anymore because deflate is decided *before* the body loop, so
`TailFallbackSignal`, `triggerTailFallback`, and `walkBodyTail` (removed from
`fromPart10.js`) are deleted.

The brief's preferred "delete the buffer, emit directly" is **incompatible with the
binding length-parity requirement** for undefined-length SQ. Empirically (probe against
buffered `fromPart10` with a length-capturing listener) buffered emits
`startSequence({ length })` and `startItem({ length })` with the *parser's computed
content span* (e.g. `00081032:74`, `00081111:242`), **not** the on-wire `0xFFFFFFFF`.
That span is unknown until the closing `FFFE,E0DD` / `FFFE,E00D` is reached, and
`startSequence` must precede its items. Direct emission would therefore diverge from
buffered — violating "parity is with the BUFFERED EVENT, assert it in tests" (Test 21).

Resolution: **defined-length** SQ/items emit directly (length known = declared);
**undefined-length** SQ/items buffer their subtree events (lambdas, with decoded values
baked in at parse time) only long enough to backfill the content-span length, then
flush. Buffering is bounded by metadata-sized subtrees (the corpus max is ~1.9 KB); the
huge pixel data is encapsulated, never an SQ, so it streams and is never buffered. This
is the "decide + justify" latitude the brief granted, chosen to satisfy the *binding*
length-parity gate. Test 21 confirms element-for-element `startSequence` length parity.

---

## BOT handling outcome

Buffered `findEndOfEncapsulatedElement` treats the **first** `FFFE,E000` item as the
Basic Offset Table: it reads the BOT length, loads the offsets into
`element.basicOffsetTable`, and iterates the *remaining* items as `element.fragments`.
Buffered `fromPart10` emits one `binaryFragment` per `el.fragments` entry — the BOT is
**not** emitted. `emitEncapsulated` mirrors this exactly: it reads the first item header,
skips its `botLen` bytes (which is 0 for the "no-bot" fixtures — an *empty* first item is
always present), then emits one `binaryFragment` (fresh copy) per subsequent fragment
until `FFFE,E0DD`. The corpus encapsulated fixtures with BOT counts 0/1/2 all pass the
byte-for-byte equivalence gate (Test 18). `await target.awaitDrain()` is issued between
fragments (safe no-op under the equivalence listeners; provides real backpressure under
a drain gate).

**Documented delta**: `emitEncapsulated` emits the `startElement` length as the on-wire
`0xFFFFFFFF`, whereas buffered emits the parser's computed span (e.g. `164406`). This is
*forced* by fragment streaming — the span is unknown until the closing delimiter, and
emitting `startElement` first is what makes fragments arrive before input completes
(Test 19). No gate checks this length (CollectorListener ignores it), so equivalence
holds.

---

## The eagerWindow leaf — reconciling the brief with reality

The brief specified scanning for `FFFE,E00D` (findItemDelimitationItem). Empirically the
**only** undefined-length non-SQ element that dcmjs decodes cleanly via
`decodeWithEagerReadTag` is the J4a case: an explicit-VR **UN** element of undefined
length (or a private implicit one), which the offsets parser routes through
`readSequenceItemsImplicit` and which ends at the **sequence** delimiter `FFFE,E0DD` —
*not* an item delimiter. The genuine `findItemDelimitationItem` VRs (e.g. OB of undefined
length) make the eager reader (`OtherByteString.read` with `UNDEFINED_LENGTH`) attempt a
4 GB read and throw — *identically* in buffered `fromPart10` (verified: a synthesized OB
undefined-length leaf crashes `runBuffered`). There is therefore no cleanly-decodable
`FFFE,E00D` eagerWindow case to bound.

`emitUndefinedLeaf` consequently bounds the window with `skipUndefinedSequence`
(walk items to `FFFE,E0DD`, with nested-item `FFFE,E00D` handling via `skipUndefinedItem`
/`skipOneElementEnd` per `findItemDelimitationItem` for undefined nested items), copies
`[elemStart, delimEnd)`, and decodes via `decodeWithEagerReadTag` — the same narrow eager
fallback buffered uses. The emitted `startElement` length is the parser's content span
(`contentEnd − dataOffset`), matching buffered (Test 22 asserts it).

Test 22 reuses the J4a builder shape (private `0099,0001` UN, undefined length, two
zero-length items, `FFFE,E0DD`). Test 23 covers the "UN-as-implicit-SQ variant" — an
implicit dictionary-unknown undefined-length element whose value starts with an item tag,
which `resolveVrInstance`'s `hadUndefinedLength → SQ` branch (confirmed by the data-peek)
classifies as an SQ and the native SQ handler emits.

---

## Chunk release — LIVE

- `ReadBufferStream` is now constructed with `clearBuffers:true` (K1's setting restored).
- `releaseEnabled = true`; after every completed **top-level** element the loop calls
  `stream.consume(stream.offset)` and reports `stream.getBufferMemoryInfo()` via the
  internal `options.onConsume` hook.
- **Deflate** returns early *before* the body loop and never consumes (still needs full
  bytes until K5); the **raw-dataset** fallback likewise slices the full buffer before any
  consume — both unaffected by `clearBuffers`.
- FMI values (Phase 2/3) are fresh `stream.slice()` copies made before any body consume,
  so the K2 FMI event replay is safe under release (re-verified). Every emitted/retained
  buffer (leaf values, fragment copies, undefined-leaf window, EventBuffer values) is a
  fresh `slice()` copy, never a reference into a releasable chunk.

### Release smoke test (Test 24) — retained bytes before/after

Streaming `CT1_UNC.fragmented_bot_jpeg_ls.80.dcm` (fileLen ≈ 170 928 B) in 4096-byte
chunks with the `onConsume` probe:

| Metric | Result |
|--------|--------|
| `onConsume` invocations (top-level elements) | ≥ 5, `consumeOffset` monotonic |
| Final retained `totalSize` | **< fileLen/2** (buffers nulled; ≈ 0 after the last consume) |
| Final retained `bufferCount` | **< ceil(fileLen/4096)** (chunks actually released) |

With release **off** (K3) the final report would still hold every fed chunk
(`totalSize == fileLen`), so a sub-half-file final `totalSize` + reduced `bufferCount`
proves `consume()` is live. (A tight per-sample *peak* assertion was dropped: the
unawaited feed loop runs ahead, so retained peaks near fileLen while the ~97%-of-file
pixel-data element is in flight — bounded per-fragment memory is the K6 formal gate.)

---

## Red-test evidence

Written FIRST against the K3 implementation (`npx jest test/eventStream/fromPart10Stream.test.js`):
**14 → 15 K4 tests RED, 32 pre-existing green.** Representative failures:
- Test 17 (no fixture tail-falls-back): 21 fixtures reported `tailFallback`.
- Tests 18/20 (encapsulated / undefined-SQ equivalence): `onPhase` was `tailFallback`.
- Test 19 (fragment before input completes): **timed out** — K3 tail-fallback awaits the
  full feed before emitting any pixel-data event. (First cut passed trivially on the FMI
  `(0002,0001)` OB fragment; tightened the listener to count only `encapsulated:true`
  fragments, which then correctly went RED.)
- Test 21 (SQ length parity), Test 22 (eagerWindow), Test 23 (UN-as-implicit-SQ),
  Test 24 (release smoke — `onConsume` never fired under K3).

All 16 GREEN after the K4 implementation; the pre-existing 283 eventStream tests and the
full 1298-test suite stayed green on both cores.

Two test-authoring corrections during RED (documented so the fixtures reflect reality,
not bugs I introduced): Test 23 first used odd group `0x2323` (private → parser clears
`items` → buffered crashes in `SequenceOfItems.read`), fixed to even `0x4444`; Test 22
first used explicit OB (crashes the buffered eager reader), replaced with the J4a UN
fixture.

---

## Self-review findings

- **Delimiter-scan alignment/step semantics**: `skipUndefinedItem` mirrors
  `findItemDelimitationItem` (2-byte-aligned, step-by-4 after a false `FFFE`). FFFE
  item/delimiter tags are read in **body endianness** (`getU16`) to match
  `@dcmjs/parser`'s `readTagPair` — the equivalence reference. The "always LE" watch item
  holds in every context that actually occurs: the implicit-SQ peek is guarded by
  `bodyImplicit` (LE==body), and encapsulated pixel data exists only in LE-based syntaxes,
  so `getU16` resolves to LE there. A hypothetical Explicit-Big-Endian sequence's item
  tags are big-endian per PS3.5 and the parser reads them so — forcing LE would *diverge*
  from the reference. (The one EBE corpus fixture has no SQ items, so this is corpus-
  untested either way; `getU16` is the choice consistent with the parser.)
- **consume() never releasing needed bytes**: consume fires only at top-level element
  boundaries; every within-element read/slice happens before that element's consume. The
  undefined-leaf window and all fragment/leaf/SQ values are fresh copies. Deflate never
  consumes and slices the full buffer. Verified no `slice()` ever indexes a nulled chunk.
- **Nested undefined SQ ↔ defined SQ**: covered by `sample-dicom`/`cine-test`/`CT0012`
  (undefined-in-undefined and defined-in-undefined) — all pass equivalence. Defined SQ
  emits directly; undefined SQ buffers; the two compose recursively via `parseOneElement`.
- **OR-complete semantics**: the new `ensureAbs(absEnd)` helper awaits then re-checks
  `absEnd <= stream.endOffset` (strict, non-complete); every call site checks the boolean.
- **Charset scoping**: `emitDefinedLeaf` decodes with the incoming decoder then updates on
  `(0008,0005)`, threading the new decoder through `parseItemElements`/the body loop —
  `(0008,0005)`'s own value is exempt from the equivalence gate, and subsequent elements
  get the updated decoder, matching K3.

---

## Concerns

- **Explicit-UN-undefined end-finding vs `FFFE,E00D` cases**: `emitUndefinedLeaf` bounds
  the window by a sequence walk (`FFFE,E0DD`), correct for the only cleanly-decodable
  eagerWindow case. A genuine `findItemDelimitationItem` element (e.g. OB of undefined
  length) both mis-frames here *and* crashes `decodeWithEagerReadTag` in buffered — both
  paths error, but not with identical error objects. Corpus-absent; no clean reference
  exists to test against.
- **Private implicit undefined-length elements** (odd group, items cleared by the parser →
  eagerWindow via `readSequenceItemsImplicit`) are handled by the same sequence-walk end-
  finder but are corpus-absent and only indirectly covered (the J4a fixture is the private
  *explicit*-UN analogue).
- **Encapsulated `startElement` length** is the on-wire `0xFFFFFFFF`, a deliberate,
  streaming-forced delta from buffered's computed span (documented above; unchecked by any
  gate).
- **Release granularity**: `consume()` frees whole chunks only once fully passed, and the
  unawaited feed runs ahead, so a single huge pixel-data element retains its bytes until it
  completes. Bounded per-fragment memory is deferred to the K6 formal memory gate; K4's
  smoke test proves release *happens*, not that it is optimally tight.

---

## Fix round 1

Two corrections applied after review of commit `4b3968d`:

### 1. False claim corrected: undefined-length text VRs do NOT behave identically in both paths

The original comment at `src/eventStream/fromPart10Stream.js` (the "Undefined-length
structural end-finders" block) stated that `findItemDelimitationItem`-class VRs "throw —
**identically** in buffered fromPart10". This is empirically false for text VRs (UT/UC/UR).

Observed behavior (synthesized Explicit-LE dataset: UT undefined-length element with "hello"
value bytes + FFFE,E00D + trailing (0008,0060) CS "CT"; pinned in Test 22b):

- **buffered fromPart10** — `readEncodedString` clamps the 0xFFFFFFFF read to the buffer
  boundary, consuming ALL remaining bytes (value bytes + FFFE,E00D delimiter bytes +
  trailing CS element bytes) as the UT string.  Returns successfully with a garbage value;
  the trailing element is silently lost from the dict.

- **fromPart10Stream** — `emitUndefinedLeaf`'s `skipUndefinedSequence` sees the non-FFFE
  value bytes as a malformed item (not FFFE,E0DD / FFFE,E000) and stops at the value start.
  The body loop then re-parses the value bytes as a DICOM element; the garbage tag/VR
  produces a declared length larger than remaining bytes → **throws**
  `"fromPart10Stream: truncated: element at N declares M bytes but stream ended"`.

This loud-failure divergence is DELIBERATE: stream fails loudly on non-conformant data that
buffered silently mishandles. DICOM PS3.5 only permits undefined length for SQ elements,
items, and encapsulated pixel data. For binary VRs (OB/OW/etc.) with undefined length, both
paths throw (buffered: "Item tag not found after undefined binary length"; stream: similar),
so no path divergence arises there.

The comment was rewritten to accurately describe all three cases (UN/text/binary) and to
note that `skipUndefinedItem` is **element-aware** — it steps whole element headers/values
via `skipOneElementEnd` — rather than a 2-byte byte-scan.

### 2. Scanner is element-aware, not a 2-byte byte-scan

The original self-review entry said `skipUndefinedItem` mirrors `findItemDelimitationItem`
"2-byte-aligned, step-by-4 after a false FFFE". That describes the *parser*'s
`findItemDelimitationItem` byte-scan algorithm. The stream's `skipUndefinedItem` is
different: it calls `skipOneElementEnd` which reads the full element header (tag + VR +
length field) and advances by the declared value length. It is element-aware, not a byte-
scan. This distinction matters for correctness on elements whose first bytes happen to look
like `0xFFFE` — the byte-scan would misframe, the element-aware skip does not.

### 3. Encapsulated `startElement` length — now pinned by a gate

Test 18b (new) asserts `pixelEl.length === 0xFFFFFFFF` using a `StartElementCapture`
listener subclass (CollectorListener drops the `length` field from `startElement`; the
inline subclass captures it before the base processes the event). The concern "unchecked by
any gate" is now resolved.

Tests added: +2 (Test 18b, Test 22b). Full suite: **1300 green / 0 skipped** (both cores).
