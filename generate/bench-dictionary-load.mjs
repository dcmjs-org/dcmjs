/**
 * Benchmark: load time of ESM (main + private) vs UMD, and old vs new dictionary.
 * Run from repo root: bun run generate/bench-dictionary-load.mjs
 * Or via package.json: "bench:dictionary": "bun run generate/bench-dictionary-load.mjs"
 *
 * Times:
 * - Old dictionary (generate/dictionary.mjs) vs new (src/dictionary.fast.js)
 * - ESM main, ESM private, UMD
 * - ESM total vs UMD comparison.
 */

import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, "..", "build");
const oldDictPath = join(__dirname, "dictionary.mjs");
const newDictPath = join(__dirname, "..", "src", "dictionary.fast.js");

async function timeImport(specifier) {
    const start = performance.now();
    await import(specifier);
    return performance.now() - start;
}

async function main() {
    console.log("--- Dictionary load benchmark (Bun) ---\n");

    // Old vs new dictionary (direct dynamic import)
    const oldDictMs = await timeImport(oldDictPath);
    console.log(`Old dictionary (generate/dictionary.mjs): ${oldDictMs.toFixed(2)} ms`);
    const newDictMs = await timeImport(newDictPath);
    console.log(`New dictionary (src/dictionary.fast.js):  ${newDictMs.toFixed(2)} ms`);
    const dictRatio = oldDictMs / newDictMs;
    console.log(`Old/New: ${dictRatio.toFixed(2)}x (${dictRatio > 1 ? "new faster" : "old faster"})\n`);

    const esmPath = join(buildDir, "dcmjs.es.js");
    const umdPath = join(buildDir, "dcmjs.js");

    // 1. ESM main
    const esmMainMs = await timeImport(esmPath);
    console.log(`ESM main (dcmjs.es.js):        ${esmMainMs.toFixed(2)} ms`);

    // 2. ESM private (loadPrivateTags) — ESM already in cache, so time only loadPrivateTags()
    const dcmjs = await import(esmPath);
    const loadPrivateStart = performance.now();
    await (dcmjs.default?.loadPrivateTags?.() ?? Promise.resolve());
    const esmPrivateMs = performance.now() - loadPrivateStart;
    console.log(`ESM private (loadPrivateTags): ${esmPrivateMs.toFixed(2)} ms`);

    const esmTotalMs = esmMainMs + esmPrivateMs;
    console.log(`ESM total:                    ${esmTotalMs.toFixed(2)} ms\n`);

    // 3. UMD
    const umdMs = await timeImport(umdPath);
    console.log(`UMD (dcmjs.js):               ${umdMs.toFixed(2)} ms\n`);

    const ratio = esmTotalMs / umdMs;
    console.log("--- Comparison ---");
    console.log(`ESM total / UMD: ${ratio.toFixed(2)}x (${ratio > 1 ? "UMD faster" : "ESM faster"})`);
    console.log("------------------\n");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
