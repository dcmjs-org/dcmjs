// scripts/bench-worker.mjs
//
// One benchmark cell: (contender, workload, file, iterations) measured in a
// fresh process so peak RSS is attributable. Invoked by scripts/bench.mjs:
//
//   node scripts/bench-worker.mjs '<json>'
//
// with { contender, workload, file, iterations, warmup }. Prints one JSON
// result line to stdout: { medianMs, p10Ms, p90Ms, maxRssMb, iterations }
// or { error }.
//
// Contenders:
//   fork         — this repository's built bundle (build/dcmjs.js — run
//                  `pnpm run build` first; the bundle IS the shipped artifact)
//   upstream     — the latest dcmjs published to npm (devDep alias
//                  `dcmjs-upstream`)
//   dicom-parser — parse-only speed-of-light reference
//
// Workloads:
//   read             — bytes -> parsed dict (parseDicom for dicom-parser)
//   read+naturalize  — bytes -> dict -> naturalized dataset (dcmjs only)
//   write            — pre-parsed dict -> Part 10 bytes (dcmjs only)
//   roundtrip        — bytes -> dict -> bytes (dcmjs only)
//   stream-walk      — fromPart10Stream over a Node fs stream with an inert
//                      listener (fork only; upstream has no streaming reader
//                      — it falls back to whole-file readFile, which is the
//                      point of the large-file rows)

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const spec = JSON.parse(process.argv[2]);
const {
    contender,
    workload,
    file,
    iterations = 20,
    warmup = 3,
    cache = null
} = spec;
// cache is a label only ("warm" | "cold" | null). Warm/cold is actually
// produced by the caller: it purges the OS page cache before a cold cell and
// passes warmup >= 1 for a warm cell (the warmup read pulls the file into
// cache before the timed read). The worker just echoes the label back so the
// parent can tabulate it.

function loadContender() {
    if (contender === "fork") {
        return require(path.join(repoRoot, "build", "dcmjs.js"));
    }
    if (contender === "upstream") {
        return require("dcmjs-upstream");
    }
    if (contender === "dicom-parser") {
        return require("dicom-parser");
    }
    throw new Error(`unknown contender ${contender}`);
}

function toArrayBuffer(buffer) {
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );
}

async function buildRunner(mod) {
    if (contender === "dicom-parser") {
        if (workload !== "read") {
            throw new Error("n/a");
        }
        const u8 = new Uint8Array(toArrayBuffer(fs.readFileSync(file)));
        return () => mod.parseDicom(u8);
    }

    const { DicomMessage, DicomMetaDictionary } = mod.data;
    if (workload === "stream-walk" && contender === "fork") {
        const { fromPart10Stream, EventStreamListener } = mod.eventStream;
        return async () => {
            const listener = new EventStreamListener();
            // A real consumer applies backpressure at the drain checkpoints
            // (write-stream drain in the CLI); an event-loop yield models
            // that. Without a gate the reader pumps arbitrarily far ahead
            // and peak RSS measures the queue, not the parser.
            listener.setDrain(() => new Promise(setImmediate));
            await fromPart10Stream(
                fs.createReadStream(file, { highWaterMark: 8 * 1024 * 1024 }),
                listener
            );
        };
    }
    if (workload === "stream-walk") {
        // Upstream has no streaming reader: the honest equivalent is
        // whole-file readFile, reading the file fresh each iteration.
        return () => {
            const fresh = toArrayBuffer(fs.readFileSync(file));
            return DicomMessage.readFile(fresh);
        };
    }

    const arrayBuffer = toArrayBuffer(fs.readFileSync(file));

    if (workload === "read") {
        return () => DicomMessage.readFile(arrayBuffer);
    }
    if (workload === "read+naturalize") {
        return () => {
            const dicomDict = DicomMessage.readFile(arrayBuffer);
            return DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        };
    }
    if (workload === "write") {
        const dicomDict = DicomMessage.readFile(arrayBuffer);
        return () => dicomDict.write();
    }
    if (workload === "roundtrip") {
        return () => DicomMessage.readFile(arrayBuffer).write();
    }
    throw new Error(`unknown workload ${workload}`);
}

function median(sorted) {
    const mid = sorted.length >> 1;
    return sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

try {
    const mod = loadContender();
    const run = await buildRunner(mod);

    for (let i = 0; i < warmup; i++) {
        await run();
    }
    const durations = [];
    for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        await run();
        durations.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    durations.sort((a, b) => a - b);
    const maxRssMb = process.resourceUsage().maxRSS / 1024; // KB -> MB
    process.stdout.write(
        JSON.stringify({
            medianMs: median(durations),
            p10Ms: durations[Math.floor(durations.length * 0.1)],
            p90Ms: durations[Math.floor(durations.length * 0.9)],
            maxRssMb: Math.round(maxRssMb),
            iterations,
            cache
        }) + "\n"
    );
} catch (err) {
    process.stdout.write(
        JSON.stringify({ error: String(err.message || err).slice(0, 200) }) +
            "\n"
    );
    process.exitCode = 0; // an erroring cell is a RESULT (e.g. upstream on 21.8 GB)
}
