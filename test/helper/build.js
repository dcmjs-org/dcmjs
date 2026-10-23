// Builds build/ (the ESM entries and the UMD bundle) when it is absent or
// older than its sources, for the tests that read it. Jest runs test files in
// parallel workers, so a lock directory makes one worker build at a time.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(ROOT, "build");
const BUILD_TIMEOUT_MS = 300000;
const LOCK_DIR = path.join(ROOT, "tmp", "build.lock");

// The files that ensureBuild() makes.
const OUTPUTS = [
    "dcmjs.js",
    "dcmjs.es.js",
    "eventStream.es.js",
    "media.es.js",
    "encapsulated.es.js",
    "image.es.js",
    "fhir.es.js"
];

// The inputs of the bundles: newer than a bundle means a stale build.
const INPUTS = [
    "src",
    "rollup.config.mjs",
    "package.json",
    ...fs.readdirSync(path.join(ROOT, "packages")).map(d => `packages/${d}/src`)
];

function newestMtime(target) {
    if (!fs.existsSync(target)) {
        return 0;
    }
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
        return stat.mtimeMs;
    }
    return fs
        .readdirSync(target)
        .reduce(
            (newest, entry) =>
                Math.max(newest, newestMtime(path.join(target, entry))),
            stat.mtimeMs
        );
}

function buildAge() {
    const outputs = OUTPUTS.map(name => path.join(BUILD_DIR, name));
    if (!outputs.every(file => fs.existsSync(file))) {
        return "absent";
    }
    const oldestOutput = Math.min(...outputs.map(f => fs.statSync(f).mtimeMs));
    const newestInput = Math.max(
        ...INPUTS.map(input => newestMtime(path.join(ROOT, input)))
    );
    return newestInput > oldestOutput ? "stale" : "current";
}

function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Runs fn while this worker holds the lock. A lock older than the build
// timeout is from a stopped run, so it is taken over.
function withLock(fn) {
    fs.mkdirSync(path.dirname(LOCK_DIR), { recursive: true });
    const start = Date.now();
    for (;;) {
        try {
            fs.mkdirSync(LOCK_DIR);
            break;
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            const age = Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
            if (age > BUILD_TIMEOUT_MS) {
                fs.rmSync(LOCK_DIR, { recursive: true, force: true });
            } else if (Date.now() - start > BUILD_TIMEOUT_MS) {
                throw new Error("timed out waiting for the build lock");
            } else {
                sleep(200);
            }
        }
    }
    try {
        return fn();
    } finally {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
    }
}

// Builds only the ESM entries and the UMD bundle, through node and the
// rollup CLI script, so no shell is needed (the pnpm shim fails to spawn on
// Windows).
function ensureBuild() {
    if (buildAge() === "current") {
        return;
    }
    withLock(() => {
        const age = buildAge();
        if (age === "current") {
            return; // another worker built it
        }
        console.log(`build/ is ${age}, building the bundles...`);
        execFileSync(
            process.execPath,
            [
                require.resolve("rollup/dist/bin/rollup"),
                "-c",
                "--environment",
                "BUNDLES_ONLY"
            ],
            { cwd: ROOT, stdio: "inherit", timeout: BUILD_TIMEOUT_MS }
        );
    });
}

// The local chunks that a built ESM file imports, with the file itself.
function withChunks(name, seen = new Set()) {
    if (!seen.has(name)) {
        seen.add(name);
        const source = fs.readFileSync(path.join(BUILD_DIR, name), "utf8");
        for (const match of source.matchAll(
            /(?:from|import)\s+['"]\.\/([^'"]+)['"]/g
        )) {
            withChunks(match[1], seen);
        }
    }
    return [...seen];
}

module.exports = {
    ROOT,
    BUILD_DIR,
    BUILD_TIMEOUT_MS,
    ensureBuild,
    withChunks
};
