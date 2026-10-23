// test/bundle-size.test.js
//
// The wrapper bundle-size ceiling against dcmjs 0.52, and smoke tests of the
// built bundles. RELEASE_PLAN.md section 6 (step 7) holds the threshold
// policy, the baseline provenance and the current measurements.

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const {
    ROOT,
    BUILD_DIR,
    BUILD_TIMEOUT_MS,
    ensureBuild,
    withChunks
} = require("./helper/build.js");

// dcmjs@0.52.0 from npm, and the ceiling for each default bundle.
const BUNDLES = {
    "dcmjs.js": { baseline: 1384431, ceiling: 1.06 },
    "dcmjs.es.js": { baseline: 1357418, ceiling: 1.06 }
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

// The size of what an application bundler gives for an ESM entry: the entry,
// its chunks, and the @dcmjs-org/* packages that it imports, in one rollup
// bundle (WRAP-IMP-5). The packages resolve to their sources ("source"), so
// no package build is needed.
function consumerBundleSize(entry) {
    return consumerBundle(entry, "es").length;
}

// The consumer bundle of an ESM entry, as source text in `format`.
function consumerBundle(entry, format) {
    const out = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "dcmjs-consumer-")),
        "bundle.js"
    );
    try {
        execFileSync(
            process.execPath,
            [
                require.resolve("rollup/dist/bin/rollup"),
                path.join(BUILD_DIR, entry),
                "--plugin",
                "@rollup/plugin-node-resolve={exportConditions:['source']}",
                "--plugin",
                "@rollup/plugin-commonjs",
                "--plugin",
                "@rollup/plugin-json",
                "--format",
                format,
                "--name",
                "dcmjs",
                "--exports",
                "named",
                "--file",
                out,
                "--silent"
            ],
            { cwd: ROOT, stdio: "inherit", timeout: BUILD_TIMEOUT_MS }
        );
        return fs.readFileSync(out);
    } finally {
        fs.rmSync(path.dirname(out), { recursive: true, force: true });
    }
}

describe("bundle size vs dcmjs 0.52", () => {
    beforeAll(() => {
        ensureBuild();
    }, BUILD_TIMEOUT_MS);

    test.each(Object.keys(BUNDLES))(
        "%s stays under its ceiling",
        bundleName => {
            const { baseline, ceiling } = BUNDLES[bundleName];
            // The UMD file is complete; an ESM entry needs its packages.
            const size = bundleName.endsWith(".es.js")
                ? consumerBundleSize(bundleName)
                : fs.statSync(path.join(BUILD_DIR, bundleName)).size;
            const ratio = size / baseline;

            console.log(
                `bundle-size: ${bundleName} = ${size} bytes ` +
                    `(0.52 baseline ${baseline}, ratio ×${ratio.toFixed(3)}, ` +
                    `ceiling ×${ceiling})`
            );
            expect(ratio).toBeLessThanOrEqual(ceiling);
        },
        BUILD_TIMEOUT_MS
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

describe("the ESM consumer bundle works in a browser", () => {
    beforeAll(() => {
        ensureBuild();
    }, BUILD_TIMEOUT_MS);

    test(
        "it loads and naturalizes with no `process` global",
        () => {
            // A browser bundler gives no `process`, and 0.52 needed none.
            const code = consumerBundle("dcmjs.es.js", "iife").toString();
            // the browser globals that the code uses, and no `process`
            const context = vm.createContext({
                console,
                TextDecoder,
                TextEncoder,
                URL,
                atob,
                btoa
            });
            vm.runInContext(code, context);
            const dcmjs = context.dcmjs.default;
            const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset({
                "00100020": { vr: "LO", Value: ["PID"] }
            });
            expect(dataset.PatientID).toBe("PID");
        },
        BUILD_TIMEOUT_MS
    );
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
