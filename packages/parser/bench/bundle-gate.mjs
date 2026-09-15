/**
 * Bundle / side-effect gate for @dcmjs/parser (REWIRING-PLAN.md, R8 step 2).
 *
 * Proves that importing the parser package:
 *   1. resolves entirely from packages/parser/src -- no external imports.
 *      Only the node builtin 'zlib' would be tolerated, and in the current
 *      source even that never surfaces: parseDicom.js reaches zlib through a
 *      guarded runtime `require('zlib')` (Node-only deflate path), which
 *      rollup leaves as a plain call expression, not a module import.
 *   2. pulls zero dictionary bytes and zero dcmjs code (marker strings) and
 *      does not bundle or import pako. The parser intentionally probes the
 *      `pako` *global* (`typeof pako !== 'undefined'` / `pako.inflateRaw(`)
 *      for the browser deflate path; exactly those two forms are allowed.
 *   3. stays small: generated code < 120 kB.
 *   4. has no import side effects: a child node process imports the bundle
 *      and asserts no new globals, no console calls, no stray stdout/stderr,
 *      and import completes in < 300 ms.
 *
 * Run from the repo root: pnpm run gate:parser-bundle
 */

import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..', 'src');
const entry = path.join(srcDir, 'index.js');

const SIZE_LIMIT_BYTES = 120_000; // 120 kB
const IMPORT_TIME_LIMIT_MS = 300;
const ALLOWED_EXTERNALS = new Set(['zlib', 'node:zlib']);
const FORBIDDEN_STRINGS = ['dicom.packed', 'dictionary.private', 'PatientName'];

const failures = [];
const fail = (msg) => failures.push(msg);

// ---------------------------------------------------------------------------
// 1. Bundle with rollup (default treeshaking, node resolution, no file output)
// ---------------------------------------------------------------------------

const externalIdsSeen = new Set();
const rollupWarnings = [];

const bundle = await rollup({
    input: entry,
    plugins: [nodeResolve()],
    external(id) {
        // Record every id rollup asks about that is not a relative/absolute
        // path; never mark anything external ourselves. Anything rollup
        // cannot resolve shows up as an UNRESOLVED_IMPORT warning and as a
        // chunk import below.
        if (!id.startsWith('.') && !path.isAbsolute(id)) {
            externalIdsSeen.add(id);
        }
        return false;
    },
    onwarn(warning) {
        rollupWarnings.push(warning);
    },
});

const { output } = await bundle.generate({ format: 'es' });
await bundle.close();

for (const warning of rollupWarnings) {
    if (warning.code === 'UNRESOLVED_IMPORT') {
        const source = warning.exporter ?? warning.source ?? '(unknown)';
        if (!ALLOWED_EXTERNALS.has(source)) {
            fail(`Unresolved external import '${source}' (importer: ${warning.id ?? 'unknown'}). The parser must be self-contained; only the node builtin 'zlib' is tolerated.`);
        }
    } else {
        console.log(`note: rollup warning [${warning.code}]: ${warning.message}`);
    }
}

const chunks = output.filter((o) => o.type === 'chunk');
if (chunks.length !== 1) {
    fail(`Expected exactly 1 output chunk, got ${chunks.length} (${output.map((o) => o.fileName).join(', ')}). Code splitting means dynamic imports leaked in.`);
}
const chunk = chunks[0];

for (const id of chunk.imports.concat(chunk.dynamicImports)) {
    if (!ALLOWED_EXTERNALS.has(id)) {
        fail(`Generated bundle imports external module '${id}'. The parser must bundle with zero dependencies (only the node builtin 'zlib' is tolerated).`);
    }
}

const moduleIds = Object.keys(chunk.modules);
for (const id of moduleIds) {
    if (!id.startsWith(srcDir + path.sep)) {
        fail(`Bundled module '${id}' is outside packages/parser/src. The parser pulled in code from elsewhere (dcmjs src or node_modules).`);
    }
    if (/pako/i.test(id)) {
        fail(`Bundled module '${id}' looks like pako. The parser must not bundle an inflater.`);
    }
}

const externalLeaks = [...externalIdsSeen].filter((id) => !ALLOWED_EXTERNALS.has(id));
if (externalLeaks.length > 0) {
    fail(`Rollup was asked to resolve bare module specifier(s) ${externalLeaks.join(', ')} from parser source. The parser must not import bare specifiers.`);
}

const code = chunk.code;
const sizeBytes = Buffer.byteLength(code, 'utf8');

// ---------------------------------------------------------------------------
// 2. Marker-string scan: no dictionary bytes, no dcmjs code, no pako module
// ---------------------------------------------------------------------------

for (const marker of FORBIDDEN_STRINGS) {
    const at = code.indexOf(marker);
    if (at !== -1) {
        fail(`Generated code contains forbidden marker '${marker}' (offset ${at}: ...${code.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' ')}...). Dictionary/dcmjs bytes leaked into the parser bundle.`);
    }
}

// pako: scan comment-stripped code so doc comments do not trip the gate, and
// allow only the two intentional global-probe forms from parseDicom.js.
const strippedCode = stripComments(code);
const pakoRe = /\bpako\b/g;
let m;
while ((m = pakoRe.exec(strippedCode)) !== null) {
    const i = m.index;
    const isTypeofProbe = strippedCode.slice(Math.max(0, i - 7), i) === 'typeof ';
    const isGlobalCall = strippedCode.slice(i + 4, i + 16) === '.inflateRaw(';
    if (!isTypeofProbe && !isGlobalCall) {
        fail(`Generated code references 'pako' outside the allowed global-probe forms (offset ${i}: ...${strippedCode.slice(Math.max(0, i - 50), i + 50).replace(/\s+/g, ' ')}...). pako must never be imported or bundled.`);
    }
}

function stripComments(input) {
    let out = '';
    let state = 'code'; // code | line | block | single | double | template
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        const next = input[i + 1];
        if (state === 'code') {
            if (c === '/' && next === '/') { state = 'line'; i++; continue; }
            if (c === '/' && next === '*') { state = 'block'; i++; continue; }
            if (c === '\'') state = 'single';
            else if (c === '"') state = 'double';
            else if (c === '`') state = 'template';
            out += c;
        } else if (state === 'line') {
            if (c === '\n') { state = 'code'; out += c; }
        } else if (state === 'block') {
            if (c === '*' && next === '/') { state = 'code'; i++; }
        } else { // inside a string/template literal
            out += c;
            if (c === '\\') { out += next ?? ''; i++; continue; }
            if ((state === 'single' && c === '\'') ||
                (state === 'double' && c === '"') ||
                (state === 'template' && c === '`')) {
                state = 'code';
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// 3. Size gate
// ---------------------------------------------------------------------------

if (sizeBytes >= SIZE_LIMIT_BYTES) {
    fail(`Generated bundle is ${sizeBytes} bytes, which exceeds the ${SIZE_LIMIT_BYTES} byte limit.`);
}

// ---------------------------------------------------------------------------
// 4. Import side-effect gate (child node process imports the bundle)
// ---------------------------------------------------------------------------

const runnerSource = `
const before = new Set(Object.getOwnPropertyNames(globalThis));
const consoleCalls = [];
for (const name of ['log', 'warn', 'error', 'info', 'debug', 'trace', 'table', 'dir', 'group', 'groupEnd', 'count', 'assert']) {
    console[name] = (...args) => { consoleCalls.push(name + ': ' + args.map(String).join(' ')); };
}
const t0 = process.hrtime.bigint();
const mod = await import('./parser-bundle.mjs');
const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
const newGlobals = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k));
process.stdout.write(JSON.stringify({
    elapsedMs,
    newGlobals,
    consoleCalls,
    exportCount: Object.keys(mod).length,
    parseDicomIsFunction: typeof mod.parseDicom === 'function' && typeof (mod.default && mod.default.parseDicom) === 'function',
}));
`;

let sideEffect = null;
const tempDir = mkdtempSync(path.join(tmpdir(), 'parser-bundle-gate-'));
try {
    writeFileSync(path.join(tempDir, 'parser-bundle.mjs'), code);
    writeFileSync(path.join(tempDir, 'runner.mjs'), runnerSource);
    const child = spawnSync(process.execPath, [path.join(tempDir, 'runner.mjs')], {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 30_000,
    });

    if (child.status !== 0) {
        fail(`Side-effect child process exited with status ${child.status}. stderr: ${child.stderr.trim() || '(empty)'}`);
    } else {
        if (child.stderr.trim() !== '') {
            fail(`Importing the bundle wrote to stderr: ${child.stderr.trim()}`);
        }
        try {
            sideEffect = JSON.parse(child.stdout);
        } catch {
            fail(`Side-effect child stdout was not the expected clean JSON report (the module wrote to stdout during import?): ${child.stdout.slice(0, 300)}`);
        }
    }

    if (sideEffect !== null) {
        if (sideEffect.newGlobals.length > 0) {
            fail(`Importing the bundle defined new globals: ${sideEffect.newGlobals.join(', ')}. Module import must not pollute globalThis.`);
        }
        if (sideEffect.consoleCalls.length > 0) {
            fail(`Importing the bundle called console: ${sideEffect.consoleCalls.join(' | ')}. Module import must be silent.`);
        }
        if (sideEffect.elapsedMs >= IMPORT_TIME_LIMIT_MS) {
            fail(`Importing the bundle took ${sideEffect.elapsedMs.toFixed(2)} ms, which exceeds the ${IMPORT_TIME_LIMIT_MS} ms limit.`);
        }
        if (!sideEffect.parseDicomIsFunction) {
            fail('Bundle import sanity check failed: parseDicom is not exported as a function (named and default export). Treeshaking removed real code.');
        }
    }
} finally {
    rmSync(tempDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('parser bundle gate');
console.log(`  entry:            ${entry}`);
console.log(`  modules bundled:  ${moduleIds.length} (all under packages/parser/src)`);
console.log(`  external imports: ${chunk.imports.length === 0 && chunk.dynamicImports.length === 0 ? 'none' : chunk.imports.concat(chunk.dynamicImports).join(', ')}`);
console.log(`  generated size:   ${sizeBytes} bytes (limit ${SIZE_LIMIT_BYTES})`);
if (sideEffect !== null) {
    console.log(`  import time:      ${sideEffect.elapsedMs.toFixed(2)} ms (limit ${IMPORT_TIME_LIMIT_MS})`);
    console.log(`  exports:          ${sideEffect.exportCount} named exports plus default`);
    console.log('  side effects:     no new globals, no console calls');
}
console.log('  note: zlib is reached via a guarded runtime require() in parseDicom.js, so it never appears as a module import; pako is probed as a browser global only.');

if (failures.length > 0) {
    console.log(`verdict: FAIL (${failures.length} assertion${failures.length === 1 ? '' : 's'} failed)`);
    for (const f of failures) {
        console.log(`  - ${f}`);
    }
    process.exitCode = 1;
} else {
    console.log('verdict: PASS');
}
