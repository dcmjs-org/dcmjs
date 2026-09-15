// scripts/corpus-runner.mjs
//
// Corpus stress-runner: walk directories (or explicit files) of DICOM Part 10
// files and push every one through the library's read paths, reporting
// per-file status, timing, and cross-path divergence:
//
//   1. classic  — DicomMessage.readFile(arrayBuffer)  (what app adapters use)
//   2. buffered — fromPart10 → CollectorListener      (event-stream reference)
//   3. stream   — fromPart10Stream fed in --chunk-size pieces → CollectorListener
//                 (the incremental parser, exercised exactly like a network
//                 or file stream)
//
// The buffered and streamed dict trees are deep-compared at the {vr, Value}
// level (the same gate the fromPart10Stream jest suite uses), with the same
// tolerances: group-length tags skipped, binary values compared by
// concatenated bytes (fragmenting may differ), String boxing ignored.
// Optionally (--compare-dicom-parser) a fourth parse with dicom-parser checks
// a core tag set against the legacy engine.
//
// Usage:
//   node scripts/corpus-runner.mjs <dir-or-file> [...more] [options]
//   pnpm run corpus -- test/ --compare-dicom-parser
//
// Options:
//   --chunk-size <bytes>      streaming chunk size (default 65536)
//   --compare-dicom-parser    also diff core tags against dicom-parser
//   --json <file>             write the full JSON report to a file
//   --quiet                   only print findings and the summary
//
// Exit code: 0 all clean; 1 any parse failure or cross-path mismatch.
//
// Files are discovered recursively: *.dcm/*.dicom/*.lei always; other files
// are sniffed for the DICM magic at offset 128.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dcmjs = require(path.join(repoRoot, "build", "dcmjs.js"));

const { DicomMessage } = dcmjs.data;
const { fromPart10, fromPart10Stream, CollectorListener } = dcmjs.eventStream;

// Parser chatter ("Invalid vr type xs - using US") drowns the report on a
// large corpus; keep the runner's own output as the signal. The chatter is
// error-level on the "validation.dcmjs" child logger, so silence that one.
dcmjs.log.setLevel("silent");
dcmjs.log.getLogger("validation.dcmjs").setLevel("silent");

// ---------------------------------------------------------------------------
// CLI

const args = process.argv.slice(2);
const inputs = [];
let chunkSize = 64 * 1024;
let compareDicomParser = false;
let jsonOut = null;
let quiet = false;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--chunk-size") {
        chunkSize = parseInt(args[++i], 10);
    } else if (arg === "--compare-dicom-parser") {
        compareDicomParser = true;
    } else if (arg === "--json") {
        jsonOut = args[++i];
    } else if (arg === "--quiet") {
        quiet = true;
    } else if (arg === "--help" || arg === "-h") {
        console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8")
            .split("\n").filter(l => l.startsWith("//")).map(l => l.slice(3)).join("\n"));
        process.exit(0);
    } else {
        inputs.push(arg);
    }
}

if (inputs.length === 0) {
    inputs.push(path.join(repoRoot, "test"));
}

let dicomParser = null;
if (compareDicomParser) {
    dicomParser = require("dicom-parser");
}

// ---------------------------------------------------------------------------
// Discovery

function isDicomFile(filePath) {
    if (/\.(dcm|dicom|lei)$/i.test(filePath)) { return true; }
    if (/\.(js|json|md|html|ts|map|zip|gz)$/i.test(filePath)) { return false; }
    // Sniff the DICM magic (Part 10 preamble is 128 bytes, then "DICM")
    let fd;
    try {
        fd = fs.openSync(filePath, "r");
        const magic = Buffer.alloc(4);
        const read = fs.readSync(fd, magic, 0, 4, 128);
        return read === 4 && magic.toString("ascii") === "DICM";
    } catch (err) {
        return false;
    } finally {
        if (fd !== undefined) { fs.closeSync(fd); }
    }
}

function discover(target, found) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(target).sort()) {
            if (entry === "node_modules" || entry.startsWith(".")) { continue; }
            discover(path.join(target, entry), found);
        }
    } else if (stat.isFile() && isDicomFile(target)) {
        found.push(target);
    }
    return found;
}

// ---------------------------------------------------------------------------
// Parse paths

function errText(err) {
    if (err instanceof Error) { return err.message || err.constructor.name; }
    return String(err ?? "unknown rejection");
}

function toArrayBuffer(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function* chunked(buffer, size) {
    for (let offset = 0; offset < buffer.byteLength; offset += size) {
        yield new Uint8Array(buffer.buffer, buffer.byteOffset + offset,
            Math.min(size, buffer.byteLength - offset));
    }
}

async function runBuffered(arrayBuffer) {
    const listener = new CollectorListener();
    await fromPart10(arrayBuffer, listener);
    return listener.result;
}

async function runStreamed(buffer, size) {
    const listener = new CollectorListener();
    await fromPart10Stream(chunked(buffer, size), listener);
    return listener.result;
}

// ---------------------------------------------------------------------------
// Tree comparison — {vr, Value} per tag, with the jest gate's tolerances:
// group-length tags skipped, binary compared by concatenated bytes,
// String-boxing ignored. Self-contained by design (mirrors
// test/eventStream/fromPart10Stream.test.js, which keeps its helpers local).

const isGroupLength = tag => tag.slice(4) === "0000";

function isBinary(value) {
    return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function isBinaryValueList(values) {
    return Array.isArray(values) && values.some(isBinary);
}

function concatBytes(values) {
    const parts = values.map(v => v instanceof ArrayBuffer
        ? new Uint8Array(v)
        : new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
}

function bytesEqual(a, b) {
    if (a.length !== b.length) { return false; }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) { return false; }
    }
    return true;
}

const isStringLike = v => typeof v === "string" || v instanceof String;

function diffValues(a, b, atPath, out, cap) {
    if (out.length >= cap) { return; }
    if (Object.is(a, b)) { return; }
    if (isStringLike(a) && isStringLike(b)) {
        if (String(a) !== String(b)) {
            out.push(`${atPath}: "${a}" vs "${b}"`);
        }
        return;
    }
    if (isBinary(a) || isBinary(b)) {
        if (!isBinary(a) || !isBinary(b)) {
            out.push(`${atPath}: binary vs ${isBinary(a) ? typeof b : typeof a}`);
        } else if (!bytesEqual(concatBytes([a]), concatBytes([b]))) {
            out.push(`${atPath}: binary bytes differ (${a.byteLength} vs ${b.byteLength})`);
        }
        return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        // Binary value lists compare as one concatenated payload — the
        // streaming path may fragment encapsulated data differently.
        if (isBinaryValueList(a) || isBinaryValueList(b)) {
            if (!bytesEqual(concatBytes(a.filter(isBinary)), concatBytes(b.filter(isBinary)))) {
                out.push(`${atPath}: concatenated binary payloads differ`);
            }
            return;
        }
        if (a.length !== b.length) {
            out.push(`${atPath}: array length ${a.length} vs ${b.length}`);
            return;
        }
        for (let i = 0; i < a.length; i++) {
            diffValues(a[i], b[i], `${atPath}[${i}]`, out, cap);
        }
        return;
    }
    if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const key of keys) {
            diffValues(a[key], b[key], `${atPath}.${key}`, out, cap);
        }
        return;
    }
    if (!(Number.isNaN(a) && Number.isNaN(b))) {
        out.push(`${atPath}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
}

function diffSection(refSection, streamSection, where, out, cap) {
    const refTags = Object.keys(refSection).filter(t => !isGroupLength(t)).sort();
    const streamTags = Object.keys(streamSection).filter(t => !isGroupLength(t)).sort();
    if (refTags.join(",") !== streamTags.join(",")) {
        const missing = refTags.filter(t => !streamTags.includes(t));
        const extra = streamTags.filter(t => !refTags.includes(t));
        out.push(`${where}: tag sets differ` +
            (missing.length ? ` missing=[${missing}]` : "") +
            (extra.length ? ` extra=[${extra}]` : ""));
        return;
    }
    for (const tag of refTags) {
        if (out.length >= cap) { return; }
        diffValues(refSection[tag].vr, streamSection[tag].vr, `${where}.${tag}.vr`, out, cap);
        diffValues(refSection[tag].Value, streamSection[tag].Value, `${where}.${tag}.Value`, out, cap);
    }
}

// ---------------------------------------------------------------------------
// dicom-parser cross-check (legacy engine baseline, core tag set)

const CORE_TAGS = [
    ["00100010", "x00100010", "PatientName"],
    ["00100020", "x00100020", "PatientID"],
    ["0020000d", "x0020000d", "StudyInstanceUID"],
    ["0020000e", "x0020000e", "SeriesInstanceUID"],
    ["00080018", "x00080018", "SOPInstanceUID"],
    ["00080060", "x00080060", "Modality"],
    ["00280010", "x00280010", "Rows"],
    ["00280011", "x00280011", "Columns"]
];

function diffAgainstDicomParser(dict, byteArray, out) {
    const dataSet = dicomParser.parseDicom(byteArray);
    for (const [tag, legacyTag, keyword] of CORE_TAGS) {
        const legacy = (keyword === "Rows" || keyword === "Columns")
            ? dataSet.uint16(legacyTag)
            : dataSet.string(legacyTag);
        if (legacy === undefined || legacy === "") { continue; }
        const entry = dict[tag.toUpperCase()] || dict[tag];
        let ours = entry && entry.Value && entry.Value[0];
        if (ours === undefined || ours === null) {
            out.push(`${keyword}: dcmjs missing, dicom-parser has ${JSON.stringify(legacy)}`);
            continue;
        }
        if (typeof ours === "object" && !isStringLike(ours) && ours.Alphabetic !== undefined) {
            ours = ours.Alphabetic; // PN model form
        }
        if (String(ours).trim() !== String(legacy).trim()) {
            out.push(`${keyword}: dcmjs ${JSON.stringify(String(ours))}` +
                ` vs dicom-parser ${JSON.stringify(String(legacy))}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Run

const files = [];
for (const input of inputs) {
    discover(path.resolve(input), files);
}

if (files.length === 0) {
    console.error("No DICOM files found under: " + inputs.join(", "));
    process.exit(1);
}

console.log(`corpus-runner: ${files.length} file(s), chunk size ${chunkSize}` +
    (compareDicomParser ? ", dicom-parser cross-check ON" : ""));

const report = [];
let failures = 0;

for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const buffer = fs.readFileSync(file);
    const record = { file: rel, bytes: buffer.byteLength };

    // 1. classic reader (what app adapters call)
    let classicDict = null;
    let start = performance.now();
    try {
        classicDict = DicomMessage.readFile(toArrayBuffer(buffer));
        record.classicMs = +(performance.now() - start).toFixed(1);
    } catch (err) {
        record.classicError = errText(err);
    }

    // 2. buffered event-stream reference
    let buffered = null;
    try {
        buffered = await runBuffered(toArrayBuffer(buffer));
    } catch (err) {
        record.bufferedError = errText(err);
    }

    // 3. incremental stream
    let streamed = null;
    start = performance.now();
    try {
        streamed = await runStreamed(buffer, chunkSize);
        record.streamMs = +(performance.now() - start).toFixed(1);
    } catch (err) {
        record.streamError = errText(err);
    }

    // 4. buffered vs streamed tree divergence
    if (buffered && streamed) {
        const mismatches = [];
        diffSection(buffered.meta, streamed.meta, "meta", mismatches, 10);
        diffSection(buffered.dict, streamed.dict, "dict", mismatches, 10);
        if (mismatches.length) { record.pathMismatches = mismatches; }
    }

    // 5. legacy engine cross-check
    if (compareDicomParser && classicDict) {
        try {
            const legacyDiffs = [];
            diffAgainstDicomParser(classicDict.dict, new Uint8Array(buffer), legacyDiffs);
            if (legacyDiffs.length) { record.legacyMismatches = legacyDiffs; }
        } catch (err) {
            record.legacyParserError = errText(err); // dicom-parser itself choked — informational
        }
    }

    // A file every path rejects is a malformed input handled gracefully —
    // informational, not a library defect. A file SOME paths accept and
    // others reject is a leniency divergence — that's a finding.
    const errorCount = [record.classicError, record.bufferedError, record.streamError]
        .filter(Boolean).length;
    const consistentlyRejected = errorCount === 3;
    if (consistentlyRejected) { record.rejected = true; }

    const failed = !consistentlyRejected && (errorCount > 0 ||
        record.pathMismatches || record.legacyMismatches);
    if (failed) { failures++; }

    if (!quiet || failed || consistentlyRejected) {
        const status = consistentlyRejected ? "REJECTED"
            : record.classicError ? "CLASSIC-FAIL"
            : record.bufferedError ? "BUFFERED-FAIL"
            : record.streamError ? "STREAM-FAIL"
            : record.pathMismatches ? "DIVERGED"
            : record.legacyMismatches ? "LEGACY-DIFF"
            : "ok";
        console.log(
            "  " + status.padEnd(14) +
            String(record.bytes).padStart(10) + "B" +
            "  classic " + String(record.classicMs ?? "-").padStart(7) + "ms" +
            "  stream " + String(record.streamMs ?? "-").padStart(7) + "ms" +
            "  " + rel
        );
        for (const key of ["classicError", "bufferedError", "streamError", "legacyParserError"]) {
            if (record[key]) { console.log("      " + key + ": " + record[key]); }
        }
        for (const key of ["pathMismatches", "legacyMismatches"]) {
            (record[key] || []).forEach(m => console.log("      " + m));
        }
    }

    report.push(record);
}

// ---------------------------------------------------------------------------
// Summary

const rejected = report.filter(r => r.rejected).length;
const ok = report.length - failures - rejected;
const slowest = [...report].filter(r => r.streamMs).sort((a, b) => b.streamMs - a.streamMs).slice(0, 5);
console.log(`\n${ok}/${report.length} clean, ${failures} with findings` +
    (rejected ? `, ${rejected} consistently rejected (malformed input)` : ""));
if (slowest.length && !quiet) {
    console.log("slowest (stream path):");
    slowest.forEach(r => console.log(`  ${r.streamMs}ms  ${r.file}`));
}

if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
    console.log("full report: " + jsonOut);
}

process.exit(failures ? 1 : 0);
