---
title: Performance
---

dcmjs 1.0's performance story rests on three legs: an offsets-only tokenizer
that defers all value decoding, a writer that copies clean bytes instead of
re-encoding them, and standing gates that keep both from regressing. This page
collects the measured numbers and — just as important — the caveats.

:::caution 2026-08-02 update
The lazy read core and the passthrough writer are **deprecated** (see
[The lazy read core](./architecture/lazy-core.md)); the lazy-vs-eager read
numbers and the passthrough write speedups below describe the deprecated
opt-in path, not the default. The tokenizer benchmarks and the
event-stream numbers are unaffected.
:::

:::note
All timings on this page were measured on a single developer machine
(macOS, Node). Treat them as relative indicators, not absolute promises;
run `pnpm run bench:parser` on your own hardware for parse numbers.
:::

## Measured numbers

### Parsing

The vendored tokenizer is benchmarked against the published
`dicom-parser@1.8.21` over the 23-file test corpus
(`packages/parser/testImages`):

- Geometric-mean time ratio (vendored / published): **~0.84–0.85** — the
  vendored tokenizer was **faster on every corpus file**.
- Best single-file ratio: **~0.60**, on implicit-VR files (where the interned
  VR and length-size lookup tables and numeric delimiter peeks pay off most).

The wins come from the R0 mechanical fixes: a stable 14-field element shape
(no hidden-class transitions), bulk `Uint8Array.set` fragment assembly,
scratch-buffer float reads, and numeric peeks in the sequence/delimiter loops.

### Writing

The 1.0 writer replaces the per-element temp stream and double-copy concat
with direct destination-stream writes and 16/32-bit length backpatching:

- SR-like deep tree (584 sequence items): **45.7 ms → 26.0 ms (1.76x)**.
- Large-value dataset: **92.8 ms → 28.8 ms (3.23x)**.

Output bytes were proven identical across 22 adversarial boundary datasets,
including explicit big endian and Big16 UN substitution.

An allocation probe for interleaved large writes (window-aware geometric
buffer growth): **199 MB → 4 KB** allocated.

### Dictionary load (pre-1.0 work)

Importing the packed data dictionary dropped from **181 ms → 19 ms (9.5x)**.
On top of that, 1.0 makes `nameMap` construction lazy, so import time no
longer pays for ~5000 keyword objects at all.

## Standing gates

These run as part of development and must stay green
(see the [monorepo guide](development/monorepo.md)):

- **`pnpm run bench:parser`** — hard gate: geometric-mean ratio vs the
  published `dicom-parser@1.8.21` must be **&lt;= 1.10**, and no single file
  may exceed **1.25**. The current ~0.85 leaves headroom, but the gate is what
  is enforced.
- **`pnpm run gate:parser-bundle`** — self-containment proof for
  `@dcmjs/parser`: a rollup bundle of the package must resolve entirely from
  `packages/parser/src` (29 modules, ~88 kB ESM, limit 120 kB), contain zero
  dictionary or dcmjs marker bytes, never bundle or import pako, and import
  side-effect-free in a child process in under 300 ms.
- **Byte-identity suite** — reading any corpus fixture and writing it back
  with zero edits must reproduce the input file **byte-for-byte**.
- **Dual-core equivalence** — the full 635-test main suite passes identically
  on the lazy core and on `DCMJS_CORE=eager`, plus 245 parser tests.

## Laziness characteristics

What the lazy core means in practice
(details in [lazy core architecture](architecture/lazy-core.md)):

- **Parse cost is independent of value sizes.** `readFile` tokenizes offsets
  only; a file with a 500 MB `PixelData` parses in roughly the time of its
  element count, not its byte count. You pay for a value when (and only when)
  you first access it, after which it is cached.
- **Memory is ~1x the file.** The source `Uint8Array` is retained for the
  lifetime of the dataset, and binary values are views into it rather than
  copies. The flip side: the whole buffer stays alive as long as any entry
  does.
- **Zero-copy frame views.** Encapsulated single-fragment frames materialize
  as views over the source bytes via the parser's frame toolkit — no copy.
- **Passthrough rewrites are near-memcpy.** Clean (never-assigned) entries are
  emitted as verbatim source spans; spans of 64 KB or more are emitted as
  zero-copy windows rather than copied at all. Rewriting a mostly-clean file
  costs roughly its size in `memcpy`, not a re-encode.

## Honest caveats

- **One machine.** Every number above was measured on a single development
  machine. Ratios have been stable across runs, but absolute milliseconds
  will differ on your hardware.
- **First access pays the decode.** Each lazy entry adds a getter indirection,
  and the first `Value` access allocates a small windowed stream and runs the
  VR decode. If your workload touches *every* value exactly once (for
  example, `JSON.stringify` of the whole dict), total work approaches the
  eager core's — laziness wins when you touch a subset, which is the common
  case.
- **Eager fallback loses laziness.** Streams the tokenizer rejects take a
  whole-file eager-core fallback for compatibility. Those files parse with
  0.x characteristics: full decode up front.
- **Charset passthrough is conservative.** Files whose top-level
  `SpecificCharacterSet` is anything other than absent/ASCII/UTF-8 (for
  example ISO_IR 100) always take the re-encode path on write today; a
  per-element ASCII fast path is on the [roadmap](development/roadmap.md).
- **Benchmark scope.** `bench:parser` measures the tokenizer against the
  corpus that ships with it; it does not (yet) gate the higher dcmjs layers,
  which are covered by the writer micro-benchmarks and the equivalence suite
  instead.
