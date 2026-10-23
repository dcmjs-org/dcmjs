// test/package-layout.test.js
//
// The package rules that a packed @dcmjs-org/dcmjs depends on
// (RELEASE_PLAN.md WRAP-IMP-2, WRAP-IMP-6 and WRAP-IMP-7). A break of one of
// these rules shows only after an install from the registry, so the tests
// check the rules directly.

const fs = require("fs");
const path = require("path");
const { parseAst } = require("rollup/dist/parseAst.js");

const {
    ROOT,
    BUILD_DIR,
    BUILD_TIMEOUT_MS,
    ensureBuild
} = require("./helper/build.js");

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const rootPackage = readJson(path.join(ROOT, "package.json"));

function packageDir(name) {
    return path.join(ROOT, "packages", name.slice("@dcmjs-org/".length));
}

// The @dcmjs-org/* packages that the root needs at runtime, with their own
// @dcmjs-org/* dependencies.
function runtimePackages() {
    const found = new Set();
    const visit = deps => {
        for (const name of Object.keys(deps || {})) {
            if (!name.startsWith("@dcmjs-org/") || found.has(name)) continue;
            found.add(name);
            visit(
                readJson(path.join(packageDir(name), "package.json"))
                    .dependencies
            );
        }
    };
    visit(rootPackage.dependencies);
    return [...found].sort();
}

// The entry files of a package after publish (publishConfig replaces the
// fields that it names).
function publishedEntries(pkg) {
    const published = { ...pkg, ...pkg.publishConfig };
    const entries = [published.main];
    const root = published.exports && published.exports["."];
    if (root && typeof root === "object") entries.push(...Object.values(root));
    return entries.filter(Boolean).map(entry => entry.replace(/^\.\//, ""));
}

describe("the published packages", () => {
    test.each(runtimePackages())("%s packs the files of its entry", name => {
        const pkg = readJson(path.join(packageDir(name), "package.json"));
        // Without a files list, pnpm applies the root .npmignore (src/).
        expect(pkg.files).toBeDefined();
        for (const entry of publishedEntries(pkg)) {
            const covered = pkg.files.some(
                item => entry === item || entry.startsWith(`${item}/`)
            );
            expect({ entry, covered }).toEqual({ entry, covered: true });
        }
    });

    test("a subpath of @dcmjs-org/dcmjs is ESM only", () => {
        // A require() would load a second copy of the default entry state.
        for (const [subpath, target] of Object.entries(rootPackage.exports)) {
            if (subpath === "." || subpath === "./dictionary") continue;
            expect({ subpath, target: Object.keys(target) }).toEqual({
                subpath,
                target: ["import"]
            });
        }
    });

    test("core lists each module with a top-level side effect", () => {
        // Bundlers drop an unused module that sideEffects does not list.
        const core = readJson(path.join(ROOT, "packages/core/package.json"));
        const coreSrc = path.join(ROOT, "packages/core/src");
        const withEffects = fs
            .readdirSync(coreSrc, { recursive: true })
            .filter(name => name.endsWith(".js"))
            .map(name => path.join(coreSrc, name))
            .filter(file =>
                parseAst(fs.readFileSync(file, "utf8")).body.some(
                    node =>
                        node.type === "ExpressionStatement" ||
                        (node.type === "ImportDeclaration" &&
                            node.specifiers.length === 0)
                )
            )
            .map(file =>
                `./${path.relative(path.join(ROOT, "packages/core"), file)}`
                    .split(path.sep)
                    .join("/")
            );
        expect(core.sideEffects).toEqual(expect.arrayContaining(withEffects));
    });
});

describe("the ESM build", () => {
    beforeAll(() => {
        ensureBuild();
    }, BUILD_TIMEOUT_MS);

    test("bundles no code of a runtime package", () => {
        // The runtime packages stay imports, so a bundler keeps one copy.
        const runtime = runtimePackages().map(name =>
            name.slice("@dcmjs-org/".length)
        );
        const maps = fs
            .readdirSync(BUILD_DIR)
            .filter(f => /\.es\.js\.map$|^dcmjs\.shared-.*\.js\.map$/.test(f));
        expect(maps.length).toBeGreaterThan(0);
        for (const map of maps) {
            const { sources } = readJson(path.join(BUILD_DIR, map));
            const bundled = sources.filter(source =>
                runtime.some(name => source.includes(`packages/${name}/`))
            );
            expect({ map, bundled }).toEqual({ map, bundled: [] });
        }
    });
});
