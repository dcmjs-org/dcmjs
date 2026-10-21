// test/bundle-size.test.js
//
// The wrapper bundle-size ceiling against dcmjs 0.52, and smoke tests of the
// built bundles. RELEASE_PLAN.md section 6 (step 7) holds the threshold
// policy, the baseline provenance and the current measurements.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BUILD_DIR = path.join(ROOT, "build");
const BUILD_TIMEOUT_MS = 300000;

// dcmjs@0.52.0 from npm, and the ceiling for each default bundle.
const BUNDLES = {
    "dcmjs.js": { baseline: 1384431, ceiling: 1.05 },
    "dcmjs.es.js": { baseline: 1357418, ceiling: 1.05 }
};

// The public names of build/dcmjs.es.js: the named exports of src/index.js.
const DEFAULT_ENTRY_EXPORTS = [
    "DICOMWEB",
    "adapters",
    "anonymizer",
    "async",
    "constants",
    "data",
    "default",
    "derivations",
    "log",
    "normalizers",
    "sr",
    "utilities"
];

// Each subpath entry, and one function that it must export.
const SUBPATHS = {
    "eventStream.es.js": "fromPart10",
    "media.es.js": "writeDicomDir",
    "encapsulated.es.js": "encapsulatePdf",
    "image.es.js": "buildImageDataset",
    "fhir.es.js": "fromPart10"
};

// The inputs of the bundles: newer than a bundle means a stale build.
const BUILD_INPUTS = [
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

// The local chunks that a built ESM file imports, with the file itself.
function withChunks(name, seen = new Set()) {
    if (!seen.has(name)) {
        seen.add(name);
        const source = fs.readFileSync(path.join(BUILD_DIR, name), "utf8");
        for (const match of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
            withChunks(match[1], seen);
        }
    }
    return [...seen];
}

function buildAge() {
    const outputs = [...Object.keys(BUNDLES), ...Object.keys(SUBPATHS)].map(
        name => path.join(BUILD_DIR, name)
    );
    if (!outputs.every(file => fs.existsSync(file))) {
        return "absent";
    }
    const oldestOutput = Math.min(...outputs.map(f => fs.statSync(f).mtimeMs));
    const newestInput = Math.max(
        ...BUILD_INPUTS.map(input => newestMtime(path.join(ROOT, input)))
    );
    return newestInput > oldestOutput ? "stale" : "current";
}

// Builds only the ESM entries and the UMD bundle, through node and the
// rollup CLI script, so no shell is needed (the pnpm shim fails to spawn on
// Windows).
function ensureBuild() {
    const age = buildAge();
    if (age === "current") {
        return;
    }
    console.log(`bundle-size: build/ is ${age}, building the bundles...`);
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
}

describe("bundle size vs dcmjs 0.52", () => {
    beforeAll(() => {
        ensureBuild();
    }, BUILD_TIMEOUT_MS);

    test.each(Object.keys(BUNDLES))(
        "%s stays under its ceiling",
        bundleName => {
            const { baseline, ceiling } = BUNDLES[bundleName];
            // What a consumer loads: the entry and every chunk it imports.
            const size = withChunks(bundleName).reduce(
                (total, file) =>
                    total + fs.statSync(path.join(BUILD_DIR, file)).size,
                0
            );
            const ratio = size / baseline;

            console.log(
                `bundle-size: ${bundleName} = ${size} bytes ` +
                    `(0.52 baseline ${baseline}, ratio ×${ratio.toFixed(3)}, ` +
                    `ceiling ×${ceiling})`
            );
            expect(ratio).toBeLessThanOrEqual(ceiling);
        }
    );
});

describe("the ESM entries import the workspace packages", () => {
    beforeAll(() => {
        ensureBuild();
    }, BUILD_TIMEOUT_MS);

    test("they import exactly the @dcmjs-org/* dependencies", () => {
        // A bundler resolves these from dependencies and keeps one copy.
        const imported = new Set();
        const entries = ["dcmjs.es.js", ...Object.keys(SUBPATHS)];
        for (const name of new Set(entries.flatMap(e => withChunks(e)))) {
            const source = fs.readFileSync(path.join(BUILD_DIR, name), "utf8");
            for (const match of source.matchAll(
                /from\s+['"](@dcmjs-org\/[^'"]+)['"]/g
            )) {
                imported.add(match[1]);
            }
        }
        const { dependencies } = require("../package.json");
        const listed = Object.keys(dependencies).filter(name =>
            name.startsWith("@dcmjs-org/")
        );

        expect([...imported].sort()).toEqual(listed.sort());
    });

    test("each entry exports only its public names", () => {
        // No shared internal leaks out of the default entry.
        const defaultEntry = require(path.join(BUILD_DIR, "dcmjs.es.js"));
        expect(Object.keys(defaultEntry).sort()).toEqual(DEFAULT_ENTRY_EXPORTS);
        for (const [name, main] of Object.entries(SUBPATHS)) {
            const entry = require(path.join(BUILD_DIR, name));
            expect({ name, type: typeof entry[main] }).toEqual({
                name,
                type: "function"
            });
        }
    });
});

describe("the UMD bundle works with no workspace", () => {
    // A script-tag user loads build/dcmjs.js alone, so rollup must inline
    // every import of the default entry.
    let dcmjs;

    beforeAll(() => {
        ensureBuild();
        const bundle = require(path.join(BUILD_DIR, "dcmjs.js"));
        dcmjs = bundle.default || bundle;
    }, BUILD_TIMEOUT_MS);

    test("the 0.52 surface is present", () => {
        expect(typeof dcmjs.data.DicomMessage.readFile).toBe("function");
        expect(typeof dcmjs.data.datasetToBuffer).toBe("function");
        expect(typeof dcmjs.sr).toBe("object");
        expect(typeof dcmjs.adapters).toBe("object");
        expect(typeof dcmjs.derivations.Segmentation).toBe("function");
        expect(typeof dcmjs.anonymizer.cleanTags).toBe("function");
        expect(typeof dcmjs.utilities).toBe("object");
        expect(typeof dcmjs.normalizers.Normalizer).toBe("function");
    });

    test("the subpath engines are not in the default bundle", () => {
        const source = fs.readFileSync(
            path.join(BUILD_DIR, "dcmjs.js"),
            "utf8"
        );
        expect(source).not.toMatch(/require\(['"]@dcmjs-org\//);
        // The DICOMDIR builder is only in @dcmjs-org/dcmjs/media.
        expect(source).not.toMatch(/writeDicomDir/);
        for (const namespace of [
            "eventStream",
            "media",
            "encapsulated",
            "image",
            "fhir"
        ]) {
            expect(dcmjs[namespace]).toBeUndefined();
        }
    });
});
