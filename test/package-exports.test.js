// test/package-exports.test.js
//
// The packaging contract of everything `pnpm -r publish` ships: a consumer
// must be able to BOTH import AND require every published entry point.
// dcmjs-commands hit the gap this pins: the 1.0.0-beta.4 umbrella's subpath
// exports were import-only (require("dcmjs/eventStream") failed resolution),
// and six workspace packages published raw ESM sources with no exports map
// at all, which CJS pipelines (jest above all) cannot parse.

const fs = require("fs");
const path = require("path");
const { ROOT, BUILD_DIR, ensureBuild } = require("./helper/build.js");

beforeAll(() => {
    ensureBuild();
});

// Each CJS subpath twin, and one function that it must export (the same
// signature exports that bundle-size.test.js checks on the ESM side).
const CJS_SUBPATHS = {
    "eventStream.cjs": "fromPart10",
    "media.cjs": "writeDicomDir",
    "encapsulated.cjs": "encapsulatePdf",
    "image.cjs": "buildImageDataset"
};

describe("umbrella subpath entries load under require()", () => {
    test.each(Object.entries(CJS_SUBPATHS))(
        "build/%s exports %s",
        (bundle, signature) => {
            const entry = require(path.join(BUILD_DIR, bundle));
            expect(typeof entry[signature]).toBe("function");
        }
    );

    test("dcmjs.cjs carries the 0.52 default surface", () => {
        const entry = require(path.join(BUILD_DIR, "dcmjs.cjs"));
        for (const name of [
            "data",
            "sr",
            "adapters",
            "utilities",
            "normalizers",
            "derivations",
            "anonymizer",
            "log"
        ]) {
            expect(entry[name]).toBeDefined();
        }
        expect(typeof entry.data.DicomMessage.readFile).toBe("function");
    });

    test("eventStream.cjs carries the facade and the writers", () => {
        const entry = require(path.join(BUILD_DIR, "eventStream.cjs"));
        for (const name of [
            "DicomEventStream",
            "EventStreamListener",
            "fromPart10Stream",
            "Part10Writer",
            "StreamingPart10Writer",
            "DicomWebJsonWriter"
        ]) {
            expect(typeof entry[name]).toBe("function");
        }
    });
});

describe("the root exports map points at files the build makes", () => {
    const pkg = JSON.parse(
        fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
    );

    const targets = Object.entries(pkg.exports).flatMap(([subpath, entry]) =>
        typeof entry === "string"
            ? [[subpath, "(unconditional)", entry]]
            : Object.entries(entry).map(([condition, file]) => [
                  subpath,
                  condition,
                  file
              ])
    );

    test.each(targets)("%s %s -> %s exists", (subpath, condition, file) => {
        expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    });

    test("every subpath entry has both import and require conditions", () => {
        for (const [subpath, entry] of Object.entries(pkg.exports)) {
            if (typeof entry === "string") {
                continue; // ./dictionary, ./package.json
            }
            expect({ subpath, conditions: Object.keys(entry) }).toEqual({
                subpath,
                conditions: ["import", "require"]
            });
        }
    });
});

describe("every published workspace package publishes a dual build", () => {
    const packagesDir = path.join(ROOT, "packages");
    const published = fs
        .readdirSync(packagesDir)
        .filter(dir =>
            fs.existsSync(path.join(packagesDir, dir, "package.json"))
        )
        .map(dir => ({
            dir,
            manifest: JSON.parse(
                fs.readFileSync(
                    path.join(packagesDir, dir, "package.json"),
                    "utf8"
                )
            )
        }))
        .filter(({ manifest }) => !manifest.private)
        // the unscoped alias has no build; the describe block below checks it
        .filter(({ dir }) => dir !== "dcmjs");

    test("the publishable package list is what we expect", () => {
        expect(published.map(p => p.dir).sort()).toEqual([
            "core",
            "dicomdir",
            "encapsulated",
            "fhir",
            "generator",
            "imaging",
            "legacy",
            "media",
            "parser",
            "schemas",
            "video"
        ]);
    });

    test.each(published.map(p => [p.dir, p.manifest]))(
        "packages/%s publishes dist with import and require conditions",
        (dir, manifest) => {
            const publishExports = (manifest.publishConfig || {}).exports;
            expect(publishExports).toBeDefined();
            const root = publishExports["."];
            // "types" (schemas) may lead; import and require must both be
            // dist builds.
            expect(root.import).toMatch(/^\.\/dist\//);
            expect(root.require).toMatch(/^\.\/dist\//);
            expect(publishExports["./package.json"]).toBe("./package.json");
            expect(manifest.files).toContain("dist");
            expect(manifest.scripts.build).toContain(
                "rollup.packages.config.mjs"
            );
        }
    );
});

describe("the unscoped dcmjs package re-exports @dcmjs-org/dcmjs", () => {
    const ALIAS_DIR = path.join(ROOT, "packages", "dcmjs");
    const read = dir =>
        JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));

    test("it has the same entry points as @dcmjs-org/dcmjs", () => {
        expect(Object.keys(read(ALIAS_DIR).exports)).toEqual(
            Object.keys(read(ROOT).exports)
        );
    });

    // Static: in the workspace, plain node cannot load the build, because
    // the workspace packages resolve to their sources until publish.
    test("each entry file re-exports the same entry of @dcmjs-org/dcmjs", () => {
        for (const [subpath, entry] of Object.entries(
            read(ALIAS_DIR).exports
        )) {
            if (subpath === "./package.json") {
                continue;
            }
            const target = "@dcmjs-org/dcmjs" + subpath.slice(1);
            const files =
                typeof entry === "string" ? [entry] : Object.values(entry);
            for (const file of files) {
                const text = fs.readFileSync(
                    path.join(ALIAS_DIR, file),
                    "utf8"
                );
                expect({
                    file,
                    re: text.match(/"(@dcmjs-org\/dcmjs[^"]*)"/g)
                }).toEqual({
                    file,
                    re: expect.arrayContaining([`"${target}"`])
                });
                expect(text).not.toMatch(
                    new RegExp(`"@dcmjs-org/dcmjs(?!${subpath.slice(1)}")`)
                );
            }
        }
    });

    // `export { default } from` fails at link time when the target has none.
    test("each ESM target that the alias re-exports has a default export", () => {
        const rootExports = read(ROOT).exports;
        for (const [subpath, entry] of Object.entries(
            read(ALIAS_DIR).exports
        )) {
            const file = typeof entry === "string" ? entry : entry.import;
            if (!file?.endsWith(".mjs")) {
                continue;
            }
            const text = fs.readFileSync(path.join(ALIAS_DIR, file), "utf8");
            if (!text.includes("export { default }")) {
                continue;
            }
            const target = rootExports[subpath];
            const built = fs.readFileSync(
                path.join(
                    ROOT,
                    typeof target === "string" ? target : target.import
                ),
                "utf8"
            );
            expect({
                subpath,
                hasDefault: /export default|as default\b/.test(built)
            }).toEqual({ subpath, hasDefault: true });
        }
    });
});
