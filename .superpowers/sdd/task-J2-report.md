# Stage J2 Report — Repoint `readFileLazy` onto decodeCore

## What Changed

Only `src/lazy/LazyDicomReader.js` was modified. `src/core/decodeCore.js` is untouched.

### Imports (lines 1-19 → 1-19, rewritten)

**Removed:**
- `pako` — pakoInflater gone (subsumed by `seedReadContext`)
- `parseDicom` from `@dcmjs/parser` — subsumed by `seedReadContext`
- `ReadBufferStream` from `../BufferStream.js` — no longer constructed directly
- `EXPLICIT_BIG_ENDIAN`, `IMPLICIT_LITTLE_ENDIAN`, `VM_DELIMITER`, `encodingMapping` from constants — used only in deleted functions
- `singleVRs` from DicomMessage — used only in deleted `shapeReadValues`

**Added:**
```js
import {
    resolveVrInstance, shapeReadValues, retainRaw,
    decodeElementValues, decodeWithEagerReadTag,
    classifyElement, resolveCharacterSet as coreResolveCharacterSet,
    seedReadContext
} from "../core/decodeCore.js";
```

`isParsedUnknownVr` was NOT imported — it is only referenced inside `classifyElement` (core), never directly in the lazy file after the rewrite.

### Functions Deleted

| Function | Lines (pre-J2) | Replacement |
|----------|---------------|-------------|
| `pakoInflater` | ~134-140 | Subsumed by `seedReadContext` |
| `resolveVrInstance(el, ctx, isMeta)` | ~387-424 | Imported `resolveVrInstance(el, window)` |
| `isParsedUnknownVr` | ~431-435 | Used only inside `classifyElement` (core) |
| `materializeWithEagerReadTag` | ~450-476 | `decodeWithEagerReadTag` at call sites + `_untrackedNested` at caller |
| `shapeReadValues` | ~485-509 | Imported |
| `retainRaw(ctx, …)` | ~515-517 | Imported; `ctx` satisfies `policy` shape (`ctx.forceStoreRaw` ≡ `policy.forceStoreRaw`) |
| local `resolveCharacterSet` | ~1015-1067 | Thin wrapper (see below) |

### `materializeElement` — Rewritten

Old: manual stream construction + inline routing logic.  
New: builds `window` + `policy` from `ctx`+`isMeta`, calls `classifyElement`, dispatches:
- `"sequence"` → `materializeSequence` (unchanged logic)
- `"encapsulated"` → `materializeEncapsulatedPixelData` (unchanged logic)
- `"eagerWindow"` → sets `entry._untrackedNested = true` then `decodeWithEagerReadTag(window, el, policy)`
- `"value"` → `decodeElementValues(window, el, vrInstance, policy)`

The `_untrackedNested` bookkeeping moved from inside `materializeWithEagerReadTag` to every call site (materializeElement, materializeSequence's opaque-SQ fallback, materializeEncapsulatedPixelData's BOT-off-boundary fallback).

### `materializeSequence` — Opaque-SQ Eager Fallback

The single `materializeWithEagerReadTag(ctx, el, isMeta, entry)` call replaced with inline window/policy construction + `decodeWithEagerReadTag`. Logic is identical.

### `materializeEncapsulatedPixelData` — BOT-off-boundary Eager Fallback

Same: one `materializeWithEagerReadTag` call replaced with inline window/policy construction + `decodeWithEagerReadTag`.

### `wrapSequenceItem` — `resolveVrInstance` call

Old: `resolveVrInstance(el, childCtx, false)`  
New: `resolveVrInstance(el, childCtx)` — dropped the now-unused `isMeta` third arg. `childCtx.implicit` carries the body implicit flag which the imported 2-arg version reads as `window.implicit`.

### `resolveCharacterSet` — Thin Wrapper

The old local function (which mutated `ctx.decoder` as a side effect and called `materializeElement` to read the charset value) is replaced by a wrapper that:
1. Constructs a body window from `ctx` fields
2. Calls `coreResolveCharacterSet(window, csEl, policy)`
3. Sets `ctx.decoder = result.decoder` (preserving the mutation side-effect)
4. Returns `{ vrInstance, originalValues, seedState }` (omitting `decoder` to match old return shape)

All call sites (`wrapSequenceItem`, `readFileLazy` top-level) have the unchanged signature `resolveCharacterSet(ctx, csEl, ignoreErrors)`.

### `readFileLazy` — Parse/ctx Setup

**Subsumed by `seedReadContext`:**
- `parseDicom` call with `pakoInflater` inflater, `vrCallback`, and `untilTag`
- Window buffer/offset derivation (`dataSet.byteArray.buffer`, `byteArray.byteOffset`, etc.)
- Syntax normalization via `DicomMessage._normalizeSyntax`
- `ctx.syntax`, `ctx.littleEndian`, `ctx.implicit` (now come from `bodyWindow`)

**Kept local (not subsumed):**
- `const byteArray = toUint8Array(buffer)` — needed for meta-group length byte read and `metaSourceByteArray` in writer seam
- `untilTag` normalization and its eager-fallback corners (TransferSyntaxUID stub etc.)
- Meta-group validation: `glEl` presence check, undefined-length/malformed check, boundary mismatch check
- `encapsulatedScanWarning` extraction from `dataSet.warnings`
- `_lazyWriteContext` construction
- `tsEl` presence check

**`mainSyntax` (raw TS UID for `_lazyWriteContext.sourceSyntax`):** `seedReadContext` returns only the normalised syntax in `bodyWindow.syntax`; the raw on-disk UID is needed for `sourceSyntax` (e.g. deflated TS keeps UID `1.2.840.10008.1.2.1.99` even though `sourceByteArray` is the inflated body). We re-decode `tsEl` using `resolveVrInstance(tsEl, metaWindow)` + `decodeElementValues(metaWindow, tsEl, tsVrInstance, tsPolicy)`. This is a small duplication of seedReadContext's internal TS read but avoids any change to decodeCore's API.

**`resolveVrInstance` in element loop:**  
Old: `resolveVrInstance(el, ctx, isMeta)`  
New: `resolveVrInstance(el, isMeta ? metaWindow : bodyWindow)` — uses the correct `implicit` flag from the pre-built window objects.

## Before/After Line Counts

| File | Before | After | Delta |
|------|--------|-------|-------|
| `src/lazy/LazyDicomReader.js` | 1400 | 1241 | −159 |

## `seedReadContext` Subsumption — What It Could and Could Not Take

### Subsumed (no longer in LazyDicomReader.js)
- `pakoInflater` definition
- `parseDicom` invocation + options construction (vrCallback, inflater, untilTag forwarding)
- Syntax normalization (`_normalizeSyntax`) call
- `metaWindow` and `bodyWindow` construction

### Could NOT be subsumed (local reasoning in report)

| Item | Reason |
|------|--------|
| `toUint8Array` + `byteArray` | `byteArray` is needed to read the 4 raw meta-group-length bytes and as `metaSourceByteArray` for writer spans |
| `mainSyntax` (raw TS UID) | `seedReadContext` returns only the normalised syntax; the writer needs the verbatim on-disk UID for `sourceSyntax` |
| `untilTag` normalization corner cases | Lazy-specific: TransferSyntaxUID-stub eager fallback, meta-untilTag emulation, pre-TransferSyntaxUID rejection |
| Meta-group validation (glEl, boundary mismatch) | Lazy-specific eager-fallback policy (core has no concept of the meta/body partitioning check) |
| `encapsulatedScanWarning` | `dataSet.warnings` is accessible after seed but the check logic belongs to the lazy reader |
| `_lazyWriteContext` construction | Lazy-path-only writer seam; core has no concept of it |

## Self-Review Findings

1. **Every deletion is covered by an import:** All deleted functions are either imported from core or their logic is subsumed by an imported function (e.g. `isParsedUnknownVr` → inside `classifyElement`). No orphan references remain.

2. **`retainRaw` signature compatibility:** Imported `retainRaw(policy, vr, val)` is called with `ctx` as the first arg in `materializeSequence` and `materializeEncapsulatedPixelData`. This works because `ctx.forceStoreRaw` is the only property accessed (`policy.forceStoreRaw`). Explicit and correct.

3. **`resolveVrInstance` signature change:** Old 3-arg form `(el, ctx, isMeta)` computed `ctx.implicit && !isMeta`; new 2-arg form `(el, window)` uses `window.implicit`. Every call site verified:
   - `wrapSequenceItem`: passes `childCtx` — always a body context, `childCtx.implicit === ctx.implicit` ✓
   - `readFileLazy` loop: passes `isMeta ? metaWindow : bodyWindow` — carries pre-computed `implicit` ✓
   - `readFileLazy` TS re-read: passes `metaWindow` (implicit=false, always explicit for meta) ✓

4. **`_untrackedNested` bookkeeping:** Confirmed moved from inside `materializeWithEagerReadTag` to every call site. Three sites: `materializeElement` ("eagerWindow" branch), `materializeSequence` (opaque-SQ fallback), `materializeEncapsulatedPixelData` (BOT fallback).

5. **`materializeSequence`'s opaque-SQ fallback:** Now calls `decodeWithEagerReadTag` instead of `materializeWithEagerReadTag`. The `entry._untrackedNested = true` is set before the call. Window/policy construction is inlined (same `isMeta`-based ternary as `materializeElement`).

6. **Charset wrapper semantics:** `resolveCharacterSet(ctx, csEl, ignoreErrors)` signature unchanged. The wrapper builds a body window from `ctx`, calls core, applies `ctx.decoder = result.decoder`, and returns `{ vrInstance, originalValues, seedState }` (not `decoder` — matches old return shape). The `coreResolveCharacterSet` result will be `null` only if `csEl` is falsy — but the wrapper already guards on `!csEl` before calling core, so the `if (!result) return null` branch is a safety net only.

7. **`Tag` import retained:** `Tag` is still used in `toUint8Array`... wait — actually `Tag` is used nowhere in the file after removing the local `resolveVrInstance`. Let me check.

Actually — `Tag` is NOT imported by any remaining code. It was only used in the deleted `resolveVrInstance`. The import should be removed.

*Self-review found this omission. Fix applied before commit.*

8. **`log` import:** Still needed — `log.warn` in `wrapSequenceItem` catch block.

9. **No behavior change beyond ctx→window plumbing:** The `classifyElement` dispatch replicates exactly the old `materializeElement` routing (SQ identity check, hadUndefinedLength + encapsulatedPixelData + not ParsedUnknownValue). `decodeElementValues` replicates the value-phase code. `decodeWithEagerReadTag` replicates `materializeWithEagerReadTag` minus the entry bookkeeping (now at call sites).

## Deviations / Justifications

None beyond what the brief anticipated. The brief explicitly noted that `mainSyntax` might not be subsumed — documented and handled by a local re-decode.

## Test Results

```
pnpm test
Test Suites: 73 passed, 73 total
Tests:       1244 passed, 1244 total

DCMJS_CORE=eager pnpm test
Test Suites: 73 passed, 73 total
Tests:       1244 passed, 1244 total
```

## Concerns

The `Tag` import in LazyDicomReader.js should be removed — it is no longer used after the local `resolveVrInstance` was deleted. Fix applied before commit.
