// scripts/bench.mjs
//
// The benchmark matrix: contenders × workloads × corpus, one fresh process
// per cell (scripts/bench-worker.mjs) so peak RSS is attributable and no
// contender warms another's caches. Prints a markdown table (the source of
// BENCHMARKS.md) and optionally JSON.
//
//   pnpm run build                # the fork is measured via its built bundle
//   node scripts/bench.mjs                     # committed-fixture corpus
//   node scripts/bench.mjs --large <file.dcm>  # add large-file cache rows
//   node scripts/bench.mjs --json out.json
//
// Contenders: this fork's bundle, `dcmjs-upstream` (npm latest), and
// dicom-parser (parse-only reference). Every cell reports median ms over N
// iterations (after warmup) and the process's peak RSS.
//
// The output opens with an environment line including measured cold disk
// throughput — the quantity that governs every cold number. Large files are
// measured BOTH warm (in page cache) and cold (freshly off disk), and both
// contenders share the same cache state per row, so neither is unfairly handed
// a warm or cold read by running order. A file larger than the page cache
// (~80% of RAM) can only be cold and is measured cold once.
//
// Cold cells need the OS page cache evicted first. That uses `sudo purge`
// (macOS) or drop_caches (Linux) when passwordless sudo is available; failing
// that, a cache-buster read of a >RAM `--large` file. Pass two --large files
// (one bigger than RAM) to force cold without sudo:
//   node scripts/bench.mjs --large small-but-cacheable.dcm --large over-ram.dcm

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workerPath = path.join(repoRoot, "scripts", "bench-worker.mjs");

const physicalRamBytes = os.totalmem();
// A file this size or larger cannot be fully held in the page cache, so it is
// always read cold from disk — warming it is physically impossible. Below this
// we can measure warm vs cold; at/above it, only cold exists.
const CACHEABLE_LIMIT = physicalRamBytes * 0.8;

// Drop the OS page cache so the next read of a file hits the disk, not RAM.
// Returns the method that actually took effect, which the header reports so a
// reader knows whether a "cold" number is trustworthy on their machine.
//   macOS : `sudo -n purge` (falls back to bare `purge` if it happens to work)
//   Linux : `sync` + drop_caches via sudo
// If neither is permitted (no passwordless sudo), fall back to a cache-buster:
// read a larger-than-RAM file to evict everything. If that is not available
// either, the cold number is reported as "unforced" and treated with caution.
function dropCaches(busterFile) {
    if (process.platform === "darwin") {
        for (const cmd of [["sudo", ["-n", "purge"]], ["purge", []]]) {
            try {
                execFileSync(cmd[0], cmd[1], { stdio: "ignore" });
                return "purge";
            } catch {
                /* try the next mechanism */
            }
        }
    } else if (process.platform === "linux") {
        try {
            execFileSync("sync", [], { stdio: "ignore" });
            execFileSync(
                "sudo",
                ["-n", "sh", "-c", "echo 3 > /proc/sys/vm/drop_caches"],
                { stdio: "ignore" }
            );
            return "drop_caches";
        } catch {
            /* fall through to cache-buster */
        }
    }
    if (busterFile && fs.existsSync(busterFile)) {
        // Reading a bit more than RAM's worth of other data evicts the target
        // fixture from the cache. Cap the read so we don't stream the whole
        // (possibly 20 GB) buster file when RAM's worth already suffices.
        const evictBytes = Math.round(physicalRamBytes * 1.1);
        execFileSync(process.execPath, [
            "-e",
            `const fs=require("fs");let n=0;` +
                `const s=fs.createReadStream(${JSON.stringify(busterFile)});` +
                `s.on("data",c=>{n+=c.length;if(n>=${evictBytes})s.destroy();});` +
                `s.on("close",()=>process.exit(0));`
        ]);
        return "cache-buster";
    }
    return "unforced";
}

// Sequential read throughput of the disk with a cold cache, in MB/s. Prefers a
// larger-than-RAM file (guaranteed cold on any read); otherwise purges first.
// Reads up to a 2 GB span so the probe itself stays quick.
function measureDiskThroughputMbs(candidateFiles) {
    const probeBytes = 2 * 1024 ** 3;
    // Below this the read finishes so fast that process/stream startup latency
    // dominates and the "MB/s" is meaningless (a 1 MB file yields tens of MB/s
    // of pure overhead, not disk bandwidth). Refuse rather than mislead.
    const MIN_MEANINGFUL_BYTES = 256 * 1024 ** 2;
    const overRam = candidateFiles.find(
        f => fs.existsSync(f) && fs.statSync(f).size >= CACHEABLE_LIMIT
    );
    let file = overRam;
    // For a >RAM file, read the TAIL span: the head may have been warmed by an
    // earlier cache-buster, but a byte offset past RAM's worth of data is
    // guaranteed cold. For a cacheable file we must purge first, then read the
    // head.
    let start = 0;
    if (file) {
        start = Math.max(0, fs.statSync(file).size - probeBytes);
    } else {
        file = candidateFiles.find(
            f => fs.existsSync(f) && fs.statSync(f).size >= MIN_MEANINGFUL_BYTES
        );
        if (!file) {
            return null; // nothing big enough to measure disk speed honestly
        }
        dropCaches();
    }
    const out = execFileSync(
        process.execPath,
        [
            "-e",
            `const fs=require("fs");let n=0;const t=process.hrtime.bigint();` +
                `const s=fs.createReadStream(${JSON.stringify(file)},` +
                `{start:${start},highWaterMark:8*1024*1024});` +
                `s.on("data",c=>{n+=c.length;if(n>=${probeBytes})s.destroy();});` +
                `s.on("close",()=>{const ms=Number(process.hrtime.bigint()-t)/1e6;` +
                `process.stdout.write(String(n/1024/1024/(ms/1000)));});`
        ],
        { encoding: "utf8", timeout: 30 * 60 * 1000 }
    );
    return Math.round(Number(out.trim()));
}

const CORPUS = [
    {
        name: "sample-dicom.dcm (528 KB CT image)",
        file: "test/sample-dicom.dcm",
        iterations: 40
    },
    {
        name: "cine-test.dcm (1.0 MB multiframe)",
        file: "test/cine-test.dcm",
        iterations: 30
    },
    {
        name: "sample-op.dcm (103 KB encapsulated)",
        file: "test/sample-op.dcm",
        iterations: 40
    },
    {
        name: "sample-sr.dcm (4.5 KB SR)",
        file: "test/sample-sr.dcm",
        iterations: 100
    }
];

const WORKLOADS = ["read", "read+naturalize", "write", "roundtrip"];
const CONTENDERS = ["fork", "upstream", "dicom-parser"];

function runCell(spec) {
    const out = execFileSync(
        process.execPath,
        [workerPath, JSON.stringify(spec)],
        { encoding: "utf8", timeout: 30 * 60 * 1000 }
    );
    const lastLine = out.trim().split("\n").pop();
    return JSON.parse(lastLine);
}

function fmt(result) {
    if (!result) {
        return "—";
    }
    if (result.error) {
        return `FAILS (${result.error.slice(0, 60)})`;
    }
    const ms =
        result.medianMs >= 100
            ? Math.round(result.medianMs).toLocaleString("en-US")
            : result.medianMs.toFixed(1);
    return `${ms} ms · ${result.maxRssMb} MB`;
}

// Large-file cells span milliseconds (warm) to minutes (cold), so show seconds
// once past a second and GB once past a gigabyte — the small-file `fmt` would
// print unreadable six-digit millisecond counts here.
function fmtLarge(result) {
    if (!result) {
        return "—";
    }
    if (result.error) {
        return "**FAILS**";
    }
    const ms = result.medianMs;
    const time =
        ms >= 1000
            ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s`
            : `${ms.toFixed(0)} ms`;
    const mb = result.maxRssMb;
    const mem = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
    return `${time} · ${mem}`;
}

const args = process.argv.slice(2);
const largeFiles = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--large" && args[i + 1]) {
        largeFiles.push(args[++i]);
    }
}
const jsonOut = args.includes("--json")
    ? args[args.indexOf("--json") + 1]
    : null;

const results = [];

// --- environment header: machine, RAM, and the disk speed that governs every
// cold number below. Measured before the tables so a reader can translate any
// cold time to their own hardware (cold time ≈ warm time + size ÷ disk speed).
const ramGb = (physicalRamBytes / 1024 ** 3).toFixed(0);
const diskCandidates = [
    ...largeFiles,
    path.join(repoRoot, "test", "cine-test.dcm")
];
const diskMbs = measureDiskThroughputMbs(diskCandidates);
const envLines = [
    `Environment: ${os.cpus()[0].model}, ${ramGb} GB RAM, ` +
        `Node ${process.version}, ${process.platform}`
];
if (diskMbs) {
    envLines.push(
        `Disk: ~${diskMbs} MB/s cold sequential read (measured). Files ` +
            `≥ ${(CACHEABLE_LIMIT / 1024 ** 3).toFixed(0)} GB exceed the page ` +
            `cache and are always read cold.`
    );
} else if (largeFiles.length) {
    envLines.push(
        "Disk: cold throughput not measured (no ≥256 MB file readable " +
            "cold). Cold times below still reflect real disk reads."
    );
}
console.log(envLines.join("\n"));
console.log("");

const lines = [];
lines.push(
    "| Fixture | Workload | this fork | upstream (npm) | dicom-parser |"
);
lines.push("|---|---|---|---|---|");

for (const fixture of CORPUS) {
    const filePath = path.join(repoRoot, fixture.file);
    if (!fs.existsSync(filePath)) {
        console.error(`skip (missing): ${fixture.file}`);
        continue;
    }
    for (const workload of WORKLOADS) {
        const row = { fixture: fixture.name, workload, cells: {} };
        for (const contender of CONTENDERS) {
            if (contender === "dicom-parser" && workload !== "read") {
                row.cells[contender] = null; // n/a — parse-only library
                continue;
            }
            process.stderr.write(
                `bench: ${fixture.file} ${workload} ${contender}\n`
            );
            row.cells[contender] = runCell({
                contender,
                workload,
                file: filePath,
                iterations: fixture.iterations,
                warmup: 3
            });
        }
        results.push(row);
        lines.push(
            `| ${fixture.name} | ${workload} | ${fmt(row.cells.fork)} | ` +
                `${fmt(row.cells.upstream)} | ${fmt(
                    row.cells["dicom-parser"]
                )} |`
        );
    }
}

console.log(lines.join("\n"));

// --- large-file table: cache-sensitive, so each file is measured both warm
// (in RAM) and cold (freshly off disk). A file bigger than the cache can only
// be cold. Both contenders are measured under the *same* cache state — the fix
// for the ordering bias where a first-run contender ate the cold read while the
// next got it warm.
if (largeFiles.length) {
    const largeLines = [];
    largeLines.push(
        "| File | Cache | this fork (streamed) | " +
            "upstream 0.52 (whole-file) |"
    );
    largeLines.push("|---|---|---|---|");

    for (const large of largeFiles) {
        const stat = fs.statSync(large);
        const gb = (stat.size / 1024 ** 3).toFixed(1);
        const name = `${path.basename(large)} (${gb} GB)`;
        const cacheable = stat.size < CACHEABLE_LIMIT;
        // A >RAM file (if we were given one) doubles as the cache-buster used
        // to force cold when no privileged purge is available.
        const busterFile = largeFiles.find(
            f => f !== large && fs.statSync(f).size >= CACHEABLE_LIMIT
        );
        const modes = cacheable ? ["warm", "cold"] : ["cold"];

        for (const cache of modes) {
            const row = { fixture: name, workload: "stream-walk", cache, cells: {} };
            for (const contender of ["fork", "upstream"]) {
                if (cache === "cold") {
                    const method = dropCaches(busterFile);
                    process.stderr.write(
                        `bench: evict cache before cold cell → ${method}\n`
                    );
                }
                process.stderr.write(`bench: ${name} ${cache} ${contender}\n`);
                row.cells[contender] = runCell({
                    contender,
                    workload: "stream-walk",
                    file: large,
                    iterations: 1,
                    // a warm cell reads once (into cache) before the timed read
                    warmup: cache === "warm" ? 1 : 0,
                    cache
                });
            }
            row.cells["dicom-parser"] = null;
            results.push(row);
            largeLines.push(
                `| ${name} | ${cache} | ${fmtLarge(row.cells.fork)} | ` +
                    `${fmtLarge(row.cells.upstream)} |`
            );
        }
    }
    console.log("");
    console.log(largeLines.join("\n"));
}

if (jsonOut) {
    fs.writeFileSync(
        jsonOut,
        JSON.stringify(
            { environment: envLines, diskMbs, results },
            null,
            2
        ) + "\n"
    );
    console.error(`json → ${jsonOut}`);
}
