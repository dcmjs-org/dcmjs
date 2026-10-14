# Benchmarks

How does the event-stream engine on this branch compare to the classic
buffered path, and what does chunking cost? I measured both paths on both
Node versions CI tests — Node 22 and Node 24 — on the committed fixtures and
on a 211 MB multiframe stress file, and this page records the numbers along
with exactly how to reproduce them.

Measured 2026-09-30 on an Apple M4 (16 GB RAM), macOS (Darwin 25.6.0,
arm64), Node v22.20.0 and v24.9.0, against the built bundle
(`build/dcmjs.es.js`) — the file applications actually load.

A word about the memory metric before the tables. DICOM payloads live in
`ArrayBuffer`s, which Node accounts as *external* memory outside the V8 heap
cap — so heap-size flags and heap counters miss exactly the allocations that
matter here. Every memory number below is peak **live** `ArrayBuffer` memory:
`process.memoryUsage().arrayBuffers` sampled after a forced `global.gc()`,
so uncollected garbage doesn't inflate it (EXAMPLES.md, "Prove the memory
stays flat", explains this at more length). Peaks on the sub-megabyte
fixtures wobble a few MB run to run with GC timing — read those cells as
"small"; the large-file cells are the stable, meaningful ones.

## Method

- Every cell runs in its own fresh Node process, so peak memory belongs to
  exactly one workload and nothing benefits from another cell's warmed-up
  JIT.
- Each cell reports the **median wall time** over its iterations (30 for the
  fixtures, 7 for the large file, after discarded warmup runs), with the
  min–max range in parentheses as the variance note. Timed iterations run
  first with no GC interference; a separate instrumented pass then samples
  peak live `ArrayBuffer` memory.
- The workloads, all file-to-result so both paths pay their I/O:
  - **eager read** — `fs.readFileSync` → `DicomMessage.readFile` →
    `naturalizeDataset`: the classic whole-buffer path.
  - **streaming read** — `fs.createReadStream` (1 MB chunks) →
    `DicomEventStream.fromPart10Stream` → `NaturalizedListener`: same
    result object, built from events as chunks arrive.
  - **streaming scan** — same stream, but a pass-through listener that
    retains nothing: the inspect/filter/route shape, and the one whose
    memory stays flat no matter the file size.
  - **buffered write** — `readFileSync` → `DicomMessage.readFile` →
    `dicomDict.write()`: file in, one output buffer out.
  - **streaming write** — `fromPart10Stream` → `StreamingPart10Writer`,
    output chunks handed off and released: the file-to-file copy shape,
    minus the destination disk.
- The large file is the 211 MB `big-cine.dcm` produced by the make-big
  recipe in EXAMPLES.md ("Make yourself a stress file") — a real 4 MB
  ultrasound cine inflated 48× by replaying its event stream. The two small
  files are committed fixtures from `packages/fixtures/dicom`.

## Node v22.20.0

### Read

| File | eager read (readFile + naturalize) | streaming read (NaturalizedListener) | streaming scan (retain nothing) |
|---|---|---|---|
| sample-dicom.dcm (0.5 MB) | 0.6 ms (0.4–1.8) · 1.1 MB | 2.3 ms (1.1–5.8) · 3.3 MB | 1.8 ms (1.1–7.2) · 4.3 MB |
| cine-test.dcm (1.1 MB) | 0.8 ms (0.6–2.6) · 2.2 MB | 2.5 ms (1.8–5.3) · 3.2 MB | 1.7 ms (1.3–3.9) · 3.2 MB |
| big-cine.dcm (211.2 MB) | 37.9 ms (35.3–132.2) · 422.5 MB | 58.1 ms (53.2–61.4) · 238.5 MB | 47.2 ms (43.6–51.3) · 15.5 MB |

### Write

| File | buffered write (readFile + write) | streaming write (StreamingPart10Writer) |
|---|---|---|
| sample-dicom.dcm (0.5 MB) | 1.9 ms (1.2–3.3) · 4.9 MB | 3.1 ms (2.4–4.6) · 12.5 MB |
| cine-test.dcm (1.1 MB) | 2.3 ms (1.9–3.5) · 20.8 MB | 4.4 ms (3.7–7.5) · 22.1 MB |
| big-cine.dcm (211.2 MB) | 616.0 ms (603.9–788.0) · 838.1 MB | 59.7 ms (56.8–86.6) · 9.4 MB |

### Chunk size (streaming scan of the 211 MB file)

| Chunk size | median | throughput | peak ArrayBuffer memory |
|---|---|---|---|
| 64 KB | 129.8 ms (128.5–141.6) | 1628 MB/s | 0.4 MB |
| 1 MB | 43.6 ms (40.1–50.9) | 4846 MB/s | 15.6 MB |
| whole buffer | 52.1 ms (51.4–65.7) | 4054 MB/s | 426.5 MB |

## Node v24.9.0

### Read

| File | eager read (readFile + naturalize) | streaming read (NaturalizedListener) | streaming scan (retain nothing) |
|---|---|---|---|
| sample-dicom.dcm (0.5 MB) | 0.4 ms (0.3–1.2) · 1.1 MB | 1.3 ms (0.9–1.8) · 17.9 MB | 3.1 ms (1.0–9.8) · 3.7 MB |
| cine-test.dcm (1.1 MB) | 0.6 ms (0.5–1.9) · 5.3 MB | 1.7 ms (1.3–3.4) · 12.6 MB | 1.4 ms (1.2–2.0) · 3.2 MB |
| big-cine.dcm (211.2 MB) | 41.0 ms (34.6–91.9) · 422.5 MB | 58.6 ms (47.8–110.5) · 213.8 MB | 47.1 ms (45.2–56.2) · 4.3 MB |

### Write

| File | buffered write (readFile + write) | streaming write (StreamingPart10Writer) |
|---|---|---|
| sample-dicom.dcm (0.5 MB) | 1.4 ms (1.2–19.2) · 5.8 MB | 3.7 ms (2.8–5.7) · 13.3 MB |
| cine-test.dcm (1.1 MB) | 2.1 ms (1.9–3.1) · 12.6 MB | 6.1 ms (4.0–12.9) · 16.8 MB |
| big-cine.dcm (211.2 MB) | 813.1 ms (582.2–899.6) · 840.1 MB | 60.0 ms (57.5–77.6) · 9.2 MB |

### Chunk size (streaming scan of the 211 MB file)

| Chunk size | median | throughput | peak ArrayBuffer memory |
|---|---|---|---|
| 64 KB | 115.9 ms (108.2–181.1) | 1823 MB/s | 0.4 MB |
| 1 MB | 44.1 ms (43.5–50.7) | 4789 MB/s | 4.3 MB |
| whole buffer | 52.3 ms (51.5–84.3) | 4043 MB/s | 426.2 MB |

## What to take from this

- **The two Node versions agree.** Every comparison below holds on both;
  the differences between 22 and 24 are within run-to-run noise.
- **On small files, the eager path is still the fastest way to a dataset**
  — a fraction of a millisecond either way. Streaming costs ~1–2 ms of
  per-chunk overhead there, which is why it's the large-file story, not a
  replacement for `readFile` on a 500 KB slice.
- **On the 211 MB file, streaming to the same naturalized dataset costs
  ~50% more time for ~45% less memory** (58 ms · ~214–239 MB vs 38–41 ms ·
  422 MB): the eager path must hold the input buffer *and* every
  materialized fragment, the streaming path only the result. And the
  pass-through scan — the shape you use to inspect, filter, or route
  without keeping the payload — walks all 211 MB in ~47 ms at **4–16 MB
  peak**, memory bounded by chunk size and largest element, never file
  size.
- **Streaming write is the headline: ~10–13× faster than the buffered
  writer at ~1/90th of the memory** on the large file (≈60 ms · ~9 MB vs
  616–813 ms · ~840 MB, both Node versions). The buffered path pays to
  materialize input, parsed fragments, and output buffer at once and
  re-concatenate; the streaming writer emits and releases chunks as it
  goes.
- **Chunk size matters, but gently.** 64 KB chunks cost ~2.7× the wall
  time of 1 MB chunks (more per-chunk bookkeeping) in exchange for a
  sub-megabyte memory floor; 1 MB chunks are the sweet spot (~4.8 GB/s
  here); handing the parser the whole buffer in one piece buys no speed
  over 1 MB chunks and costs whole-file memory. The default
  `fs.createReadStream` high-water mark (64 KB) is the conservative
  choice; pass `{ highWaterMark: 1024 * 1024 }` when throughput matters.

## How to reproduce

From a checkout of this branch:

```bash
pnpm install
pnpm run build

# the committed-fixture tables only
pnpm run bench

# fetch the cine and build the 211 MB stress file (recipe from EXAMPLES.md)
mkdir -p /tmp/dcmjs-examples-data && cd /tmp/dcmjs-examples-data
curl -sLO https://github.com/dcmjs-org/data/releases/download/us-multiframe-cine/us-cine.zip
unzip -o -q us-cine.zip -d us-cine
cd - && node make-big.mjs   # the "Make yourself a stress file" snippet from EXAMPLES.md

# the full matrix, including the large-file and chunk-size tables
node bench/run.mjs --big /tmp/dcmjs-examples-data/big-cine.dcm

# optionally, machine-readable output
node bench/run.mjs --big /tmp/dcmjs-examples-data/big-cine.dcm --json /tmp/bench.json
```

`bench/run.mjs` spawns one fresh process per cell (`bench/worker.mjs`, with
`--expose-gc` for the forced-GC memory sampling) using whatever `node` ran
it — so to produce the two sections above I ran the same command once under
Node 22 and once under Node 24. It prints the markdown tables this page is
built from.
