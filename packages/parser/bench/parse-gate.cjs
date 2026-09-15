'use strict';

/*
 * Parse non-regression benchmark gate (REWIRING-PLAN step 2).
 *
 * Compares the vendored tokenizer (packages/parser/src, ESM, loaded through
 * @babel/register) against the published dicom-parser package on the full
 * testImages corpus.
 *
 * Gate: geometric-mean ratio (vendored/published) <= 1.10 AND no single file
 * ratio > 1.25. Memory deltas are reported informationally (not gating) when
 * run with --expose-gc.
 *
 * Run: pnpm run bench:parser
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PARSER_SRC = path.resolve(__dirname, '..', 'src');
const TEST_IMAGES = path.resolve(__dirname, '..', 'testImages');

const GEOMEAN_LIMIT = 1.1;
const PER_FILE_LIMIT = 1.25;

const WARMUP_PARSES = 5;
const TIMED_ROUNDS = 7;
const TARGET_ROUND_MS = 50;
const MAX_K = 2000;

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

// Scope the babel hook to the vendored parser source only, so requiring the
// published package (and pako) is untouched.
require('@babel/register')({
    only: [(filename) => filename.startsWith(PARSER_SRC + path.sep)],
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    babelrc: false,
    configFile: false,
});

const vendoredModule = require(path.join(PARSER_SRC, 'index.js'));
const vendored = vendoredModule.default || vendoredModule;
const published = require(path.join(REPO_ROOT, 'node_modules', 'dicom-parser'));
const pako = require(path.join(REPO_ROOT, 'node_modules', 'pako'));

if (typeof vendored.parseDicom !== 'function') {
    throw new Error('vendored parser did not expose parseDicom');
}
if (typeof published.parseDicom !== 'function') {
    throw new Error('published dicom-parser did not expose parseDicom');
}

// Inflater contract (see parseDicom.js getDataSetByteStream): given the raw
// byte array and the position where the deflated stream starts, return a
// single byte array of the uncompressed header bytes [0, position) followed
// by the inflated remainder. Only invoked for transfer syntax
// 1.2.840.10008.1.2.1.99, so it is safe to pass for every file.
function inflater(arr, position) {
    const inflated = pako.inflateRaw(arr.slice(position));
    const full = new Uint8Array(position + inflated.length);

    full.set(arr.slice(0, position), 0);
    full.set(inflated, position);

    return full;
}

const impls = [
    { name: 'vendored', parse: (bytes) => vendored.parseDicom(bytes, { inflater }) },
    { name: 'published', parse: (bytes) => published.parseDicom(bytes, { inflater }) },
];

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

function collectCorpus() {
    const files = [];

    const addDir = (dir, predicate) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                addDir(full, predicate);
            } else if (entry.isFile() && predicate(entry.name)) {
                files.push(full);
            }
        }
    };

    // Top level + encapsulated/: every .dcm file. deflate/: the *_dfl files
    // (the deflate fixtures carry no .dcm extension).
    addDir(TEST_IMAGES, (name) => name.endsWith('.dcm') || name.endsWith('_dfl'));

    files.sort();

    return files.map((file) => ({
        name: path.relative(TEST_IMAGES, file),
        bytes: new Uint8Array(fs.readFileSync(file)),
    }));
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

let sink = 0;

function timeRound(parse, bytes, k) {
    const start = performance.now();

    for (let i = 0; i < k; i++) {
        const dataSet = parse(bytes);

        sink += dataSet.byteArray.length & 7;
    }

    return performance.now() - start;
}

function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;

    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function benchFile(entry) {
    const { bytes } = entry;

    // Warmup both implementations.
    for (const impl of impls) {
        for (let i = 0; i < WARMUP_PARSES; i++) {
            sink += impl.parse(bytes).byteArray.length & 7;
        }
    }

    // Calibrate K from the faster implementation so each round runs at least
    // ~TARGET_ROUND_MS for both.
    const perParseEstimates = impls.map((impl) => timeRound(impl.parse, bytes, 3) / 3);
    const fastest = Math.max(Math.min(...perParseEstimates), 0.0005);
    const k = Math.max(1, Math.min(MAX_K, Math.ceil(TARGET_ROUND_MS / fastest)));

    // Interleaved timed rounds: V,P,V,P,...
    const rounds = { vendored: [], published: [] };

    for (let round = 0; round < TIMED_ROUNDS; round++) {
        for (const impl of impls) {
            rounds[impl.name].push(timeRound(impl.parse, bytes, k));
        }
    }

    const vendoredMs = median(rounds.vendored) / k;
    const publishedMs = median(rounds.published) / k;

    return {
        name: entry.name,
        sizeKb: bytes.length / 1024,
        k,
        vendoredMs,
        publishedMs,
        ratio: vendoredMs / publishedMs,
    };
}

// ---------------------------------------------------------------------------
// Memory (informational)
// ---------------------------------------------------------------------------

function measureRetainedHeap(parse, corpus) {
    if (typeof global.gc !== 'function') {
        return null;
    }

    global.gc();
    const before = process.memoryUsage().heapUsed;

    const results = corpus.map((entry) => parse(entry.bytes));

    global.gc();
    const after = process.memoryUsage().heapUsed;

    sink += results.length;
    results.length = 0;
    global.gc();

    return after - before;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function formatTable(results) {
    const headers = ['file', 'size KB', 'K', 'vendored ms', 'published ms', 'ratio'];
    const rows = results.map((r) => [
        r.name,
        r.sizeKb.toFixed(1),
        String(r.k),
        r.vendoredMs.toFixed(4),
        r.publishedMs.toFixed(4),
        r.ratio.toFixed(3),
    ]);

    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
    const renderRow = (row) =>
        row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ');

    const lines = [renderRow(headers), widths.map((w) => '-'.repeat(w)).join('  ')];

    for (const row of rows) {
        lines.push(renderRow(row));
    }

    return lines.join('\n');
}

function main() {
    const corpus = collectCorpus();

    if (corpus.length === 0) {
        console.log('No corpus files found under ' + TEST_IMAGES);
        process.exitCode = 1;

        return;
    }

    const publishedVersion = require(path.join(REPO_ROOT, 'node_modules', 'dicom-parser', 'package.json')).version;

    console.log('Parse benchmark gate: vendored (packages/parser/src) vs published (dicom-parser@' +
        publishedVersion + ')');
    console.log('Corpus: ' + corpus.length + ' files from ' + TEST_IMAGES);
    console.log('Methodology: ' + WARMUP_PARSES + ' warmup parses, ' + TIMED_ROUNDS +
        ' interleaved timed rounds of K parses, median round; per-parse ms shown.');
    console.log('');

    const results = corpus.map((entry) => benchFile(entry));

    console.log(formatTable(results));
    console.log('');

    const geomean = Math.exp(results.reduce((acc, r) => acc + Math.log(r.ratio), 0) / results.length);
    const worst = results.reduce((acc, r) => (r.ratio > acc.ratio ? r : acc), results[0]);

    console.log('Geometric mean ratio (vendored/published): ' + geomean.toFixed(4) +
        ' (limit ' + GEOMEAN_LIMIT.toFixed(2) + ')');
    console.log('Worst file ratio: ' + worst.ratio.toFixed(4) + ' (' + worst.name +
        ', limit ' + PER_FILE_LIMIT.toFixed(2) + ')');

    // Informational memory check.
    console.log('');
    if (typeof global.gc === 'function') {
        for (const impl of impls) {
            const delta = measureRetainedHeap(impl.parse, corpus);
            const deltaMb = (delta / (1024 * 1024)).toFixed(2);

            console.log('Heap retained after full-corpus parse, ' + impl.name + ': ' +
                deltaMb + ' MB (informational, not gating)');
        }
    } else {
        console.log('Memory check skipped: run with --expose-gc to enable (informational only).');
    }

    const geomeanPass = geomean <= GEOMEAN_LIMIT;
    const perFilePass = worst.ratio <= PER_FILE_LIMIT;

    console.log('');
    if (geomeanPass && perFilePass) {
        console.log('GATE PASS: geomean ' + geomean.toFixed(4) + ' <= ' + GEOMEAN_LIMIT +
            ' and all per-file ratios <= ' + PER_FILE_LIMIT);
    } else {
        if (!geomeanPass) {
            console.log('GATE FAIL: geomean ratio ' + geomean.toFixed(4) + ' > ' + GEOMEAN_LIMIT);
        }
        if (!perFilePass) {
            console.log('GATE FAIL: per-file ratio ' + worst.ratio.toFixed(4) + ' > ' +
                PER_FILE_LIMIT + ' (' + worst.name + ')');
        }
        process.exitCode = 1;
    }
}

main();
