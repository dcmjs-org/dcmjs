// bench/run.mjs — the benchmark matrix behind BENCHMARKS.md.
//
//   pnpm run build                              # measures the built bundle
//   node bench/run.mjs                          # committed-fixture corpus only
//   node bench/run.mjs --big /tmp/dcmjs-examples-data/big-cine.dcm
//   node bench/run.mjs --json /tmp/bench.json
//
// Every cell runs in its own fresh Node process (bench/worker.mjs, spawned
// from this script's own node binary with --expose-gc) so peak-memory numbers
// are attributable to exactly one workload and no cell benefits from another
// having warmed the JIT. Prints the markdown tables BENCHMARKS.md is built
// from. The big file is produced by the make-big recipe in EXAMPLES.md
// ("Make yourself a stress file").

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(here);
const workerPath = path.join(here, "worker.mjs");

const args = process.argv.slice(2);
const bigFile = args.includes("--big") ? args[args.indexOf("--big") + 1] : null;
const jsonOut = args.includes("--json")
    ? args[args.indexOf("--json") + 1]
    : null;

const FIXTURES = [
    {
        name: "sample-dicom.dcm",
        file: path.join(repoRoot, "packages/fixtures/dicom/sample-dicom.dcm"),
        iterations: 30,
        warmup: 5
    },
    {
        name: "cine-test.dcm",
        file: path.join(repoRoot, "packages/fixtures/dicom/cine-test.dcm"),
        iterations: 30,
        warmup: 5
    }
];
const corpus = FIXTURES.filter(f => fs.existsSync(f.file));
if (bigFile) {
    if (!fs.existsSync(bigFile)) {
        console.error(`--big file not found: ${bigFile}`);
        process.exit(1);
    }
    corpus.push({
        name: path.basename(bigFile),
        file: bigFile,
        iterations: 7,
        warmup: 1
    });
}

function runCell(spec) {
    process.stderr.write(
        `bench: ${path.basename(spec.file)} ${spec.workload}` +
            (spec.chunkSize ? ` chunk=${spec.chunkSize}` : "") +
            "\n"
    );
    const out = execFileSync(
        process.execPath,
        ["--expose-gc", workerPath, JSON.stringify(spec)],
        { encoding: "utf8", timeout: 30 * 60 * 1000 }
    );
    return JSON.parse(out.trim().split("\n").pop());
}

const mb = bytes => (bytes / 1e6).toFixed(1);
const fmt = r =>
    `${r.medianMs.toFixed(1)} ms (${r.minMs.toFixed(1)}–${r.maxMs.toFixed(1)}) · ${r.peakArrayBuffersMB} MB`;

const results = { meta: {}, read: [], write: [], chunk: [] };
results.meta = {
    node: process.version,
    cpu: os.cpus()[0]?.model ?? "unknown",
    ram: `${Math.round(os.totalmem() / 2 ** 30)} GB`,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    date: new Date().toISOString().slice(0, 10)
};

const lines = [];
lines.push(
    `Node ${results.meta.node} · ${results.meta.cpu} · ${results.meta.ram} RAM · ` +
        `${results.meta.platform} · ${results.meta.date}`
);

// --- read table -------------------------------------------------------------
lines.push("");
lines.push("### Read");
lines.push("");
lines.push(
    "| File | eager read (readFile + naturalize) | streaming read (NaturalizedListener) | streaming scan (retain nothing) |"
);
lines.push("|---|---|---|---|");
for (const f of corpus) {
    const row = { file: f.name, fileBytes: fs.statSync(f.file).size, cells: {} };
    for (const workload of ["eager-read", "stream-read", "stream-scan"]) {
        row.cells[workload] = runCell({ workload, ...f });
    }
    results.read.push(row);
    lines.push(
        `| ${f.name} (${mb(row.fileBytes)} MB) | ${fmt(row.cells["eager-read"])} | ` +
            `${fmt(row.cells["stream-read"])} | ${fmt(row.cells["stream-scan"])} |`
    );
}

// --- write table ------------------------------------------------------------
lines.push("");
lines.push("### Write");
lines.push("");
lines.push(
    "| File | buffered write (readFile + write) | streaming write (StreamingPart10Writer) |"
);
lines.push("|---|---|---|");
for (const f of corpus) {
    const row = { file: f.name, fileBytes: fs.statSync(f.file).size, cells: {} };
    for (const workload of ["buffered-write", "stream-write"]) {
        row.cells[workload] = runCell({ workload, ...f });
    }
    results.write.push(row);
    lines.push(
        `| ${f.name} (${mb(row.fileBytes)} MB) | ${fmt(row.cells["buffered-write"])} | ` +
            `${fmt(row.cells["stream-write"])} |`
    );
}

// --- chunk-size table (big file only) ----------------------------------------
if (bigFile) {
    const f = corpus[corpus.length - 1];
    lines.push("");
    lines.push("### Chunk size (streaming scan of the large file)");
    lines.push("");
    lines.push("| Chunk size | median | throughput | peak ArrayBuffer memory |");
    lines.push("|---|---|---|---|");
    for (const chunkSize of [64 * 1024, 1024 * 1024, "whole"]) {
        const r = runCell({ workload: "stream-scan", chunkSize, ...f });
        results.chunk.push({ chunkSize, ...r });
        const label =
            chunkSize === "whole" ? "whole buffer" : `${chunkSize / 1024} KB`;
        const mbps = ((r.fileBytes / 1e6) / (r.medianMs / 1000)).toFixed(0);
        lines.push(
            `| ${label} | ${r.medianMs.toFixed(1)} ms (${r.minMs.toFixed(1)}–${r.maxMs.toFixed(1)}) | ` +
                `${mbps} MB/s | ${r.peakArrayBuffersMB} MB |`
        );
    }
}

console.log("\n" + lines.join("\n") + "\n");
if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
    console.error(`wrote ${jsonOut}`);
}
