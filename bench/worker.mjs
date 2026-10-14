// bench/worker.mjs — one benchmark cell in one fresh process.
//
// Invoked by bench/run.mjs as:
//   node --expose-gc bench/worker.mjs '<json spec>'
//
// Spec: { workload, file, iterations, warmup, chunkSize }
//   workload   eager-read | stream-read | stream-scan | buffered-write | stream-write
//   chunkSize  bytes for the read stream's highWaterMark, or "whole" to hand
//              the parser the entire buffer in one piece (stream-scan only)
//
// Prints a single JSON line: { medianMs, minMs, maxMs, iterations,
// peakArrayBuffersMB, fileBytes }.
//
// Method: timed iterations run first, with no GC calls in the way. Then one
// extra pass samples peak live ArrayBuffer memory — global.gc() before each
// sample so the number is live data, not uncollected garbage (see the
// "Prove the memory stays flat" section of EXAMPLES.md for why
// process.memoryUsage().arrayBuffers is the metric, not heap caps or RSS).

import fs from "node:fs";
import dcmjs from "../build/dcmjs.es.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;
const { DicomEventStream, EventStreamListener, NaturalizedListener, StreamingPart10Writer } =
    dcmjs.eventStream;

const spec = JSON.parse(process.argv[2]);
const { workload, file } = spec;
const iterations = spec.iterations ?? 10;
const warmup = spec.warmup ?? 2;
const chunkSize = spec.chunkSize ?? 1024 * 1024;

const fileBytes = fs.statSync(file).size;

// A sink the optimizer cannot remove.
let blackhole = 0;
const consume = v => {
    if (v !== undefined && v !== null) blackhole++;
};

// --- memory sampling --------------------------------------------------------

let peak = 0;
const sample = () => {
    if (global.gc) global.gc();
    peak = Math.max(peak, process.memoryUsage().arrayBuffers);
};
// Sampling filter injected in front of streaming listeners: one sample per
// 100 pixel-data fragments plus one per 50 top-level elements, so both
// encapsulated and native payload shapes get observed mid-flight.
let fragmentCount = 0;
let elementCount = 0;
const samplingFilter = {
    binaryFragment(next, chunk) {
        if (++fragmentCount % 100 === 0) sample();
        return next(chunk);
    },
    endElement(next, ...args) {
        if (++elementCount % 50 === 0) sample();
        return next(...args);
    }
};

// --- workloads --------------------------------------------------------------
// Each returns { run(): Promise, memRun(): Promise } — run() is the timed
// body, memRun() the instrumented pass.

function bytesView() {
    const b = fs.readFileSync(file);
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

const workloads = {
    // Whole file in one buffer -> parsed dict -> naturalized dataset.
    "eager-read": {
        async run() {
            const bytes = bytesView();
            const dict = DicomMessage.readFile(bytes.buffer);
            const nat = DicomMetaDictionary.naturalizeDataset(dict.dict);
            consume(nat.SOPInstanceUID ?? nat.Modality ?? dict);
        },
        async memRun() {
            sample();
            const bytes = bytesView();
            sample();
            const dict = DicomMessage.readFile(bytes.buffer);
            sample();
            const nat = DicomMetaDictionary.naturalizeDataset(dict.dict);
            sample();
            consume(nat.SOPInstanceUID ?? nat.Modality ?? dict);
        }
    },

    // Chunked read stream -> NaturalizedListener (collects the full dataset,
    // pixel data included — the streaming twin of eager-read).
    "stream-read": {
        async run() {
            const listener = new NaturalizedListener();
            await DicomEventStream.fromPart10Stream(
                fs.createReadStream(file, { highWaterMark: chunkSize })
            ).process(listener);
            consume(listener.result.SOPInstanceUID ?? listener.result.Modality);
        },
        async memRun() {
            const listener = new NaturalizedListener({}, samplingFilter);
            await DicomEventStream.fromPart10Stream(
                fs.createReadStream(file, { highWaterMark: chunkSize })
            ).process(listener);
            sample();
            consume(listener.result.Modality);
        }
    },

    // Chunked read stream -> pass-through listener that retains nothing:
    // the bounded-memory scan (inspect/filter/route shape).
    "stream-scan": {
        async run() {
            let payload = 0;
            const listener = new EventStreamListener({
                binaryFragment(next, chunk) {
                    payload += chunk.byteLength;
                    return next(chunk);
                }
            });
            await DicomEventStream.fromPart10Stream(source()).process(listener);
            consume(payload);
        },
        async memRun() {
            const listener = new EventStreamListener(samplingFilter);
            await DicomEventStream.fromPart10Stream(source()).process(listener);
            sample();
        }
    },

    // Whole file in one buffer -> parsed dict -> one output buffer.
    "buffered-write": {
        async run() {
            const bytes = bytesView();
            const dict = DicomMessage.readFile(bytes.buffer);
            const out = dict.write();
            consume(out.byteLength);
        },
        async memRun() {
            sample();
            const bytes = bytesView();
            const dict = DicomMessage.readFile(bytes.buffer);
            sample();
            const out = dict.write();
            sample();
            consume(out.byteLength);
        }
    },

    // Chunked read stream -> StreamingPart10Writer -> chunks handed off and
    // released (the file-to-file copy shape, minus the destination disk).
    "stream-write": {
        async run() {
            let total = 0;
            const writer = new StreamingPart10Writer({
                onChunk(c) {
                    total += c.byteLength;
                }
            });
            await DicomEventStream.fromPart10Stream(
                fs.createReadStream(file, { highWaterMark: chunkSize })
            ).process(writer);
            consume(total);
        },
        async memRun() {
            let chunks = 0;
            const writer = new StreamingPart10Writer({
                onChunk() {
                    if (++chunks % 100 === 0) sample();
                }
            });
            await DicomEventStream.fromPart10Stream(
                fs.createReadStream(file, { highWaterMark: chunkSize })
            ).process(writer);
            sample();
        }
    }
};

// stream-scan's source honors chunkSize === "whole": the entire file as one
// buffer, so chunking overhead itself can be isolated.
function source() {
    if (chunkSize === "whole") {
        return bytesView();
    }
    return fs.createReadStream(file, { highWaterMark: chunkSize });
}

// --- run --------------------------------------------------------------------

const w = workloads[workload];
if (!w) {
    console.error(`unknown workload: ${workload}`);
    process.exit(1);
}

const samples = [];
for (let i = 0; i < warmup + iterations; i++) {
    const t0 = performance.now();
    await w.run();
    const ms = performance.now() - t0;
    if (i >= warmup) samples.push(ms);
}

await w.memRun();

samples.sort((a, b) => a - b);
const medianMs = samples[Math.floor(samples.length / 2)];

console.log(
    JSON.stringify({
        medianMs: +medianMs.toFixed(2),
        minMs: +samples[0].toFixed(2),
        maxMs: +samples[samples.length - 1].toFixed(2),
        iterations,
        peakArrayBuffersMB: +(peak / 1e6).toFixed(1),
        fileBytes,
        blackhole
    })
);
