import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
// import globals from "rollup-plugin-node-globals";
// import builtins from "rollup-plugin-node-builtins";
import commonjs from "@rollup/plugin-commonjs";
// import babelRuntime from "@rollup/plugin-transform-runtime"
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import { readFileSync, readdirSync, rmSync } from "fs";
import path from "path";

const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8")
);

const sharedPlugins = [
    replace({
        "process.env.LOG_LEVEL": JSON.stringify(
            process.env.LOG_LEVEL || "warn"
        ),
        preventAssignment: true
    }),
    resolve({
        browser: true,
        // the workspace packages give their sources under "source"; Node
        // gets their dist/ build under "import"
        exportConditions: ["source"]
    }),
    commonjs(),
    babel({
        babelHelpers: "bundled",
        exclude: "node_modules/**"
    }),
    json()
];

// The ESM build imports the @dcmjs-org/* packages (listed in dependencies),
// so a bundler keeps one shared copy. The UMD builds inline them.
const isWorkspacePackage = id => id.startsWith("@dcmjs-org/");

// After a write, removes the shared chunks of earlier builds from build/,
// because `files: ["build"]` publishes every file there.
const removeOldSharedChunks = {
    name: "remove-old-shared-chunks",
    writeBundle(options, bundle) {
        for (const file of readdirSync(options.dir)) {
            const chunk = file.replace(/\.map$/, "");
            if (/^dcmjs\.shared-.*\.js$/.test(chunk) && !bundle[chunk]) {
                rmSync(path.join(options.dir, file));
            }
        }
    }
};

// `rollup -c --environment BUNDLES_ONLY` skips the minified build
// (test/bundle-size.test.js builds only what it measures).
const bundlesOnly = process.env.BUNDLES_ONLY === "true";

// The default entry and the subpath entries (@dcmjs-org/dcmjs/media, ...).
// The subpaths are ESM only. The code that the default entry shares with
// eventStream.es.js goes in one dcmjs.shared-<hash>.js chunk, so each entry
// exports only its own public names.
const esm = {
    input: {
        "dcmjs.es": "src/index.js",
        "eventStream.es": "src/eventStream.js",
        "media.es": "src/media.js",
        "encapsulated.es": "src/encapsulated.js",
        "image.es": "src/image.js"
    },
    external: isWorkspacePackage,
    output: {
        dir: "build",
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "dcmjs.shared-[hash].js",
        sourcemap: true
    },
    plugins: [...sharedPlugins, removeOldSharedChunks]
};

const umd = {
    input: "src/index.js",
    output: {
        file: pkg.main,
        format: "umd",
        name: "dcmjs",
        // a fixed indent: rollup otherwise copies it from the first module
        indent: "\t",
        sourcemap: true
    },
    plugins: sharedPlugins
};

const umdMin = {
    input: "src/index.js",
    output: {
        file: pkg.main.replace(/\.js$/, ".min.js"),
        format: "umd",
        name: "dcmjs",
        sourcemap: true,
        plugins: [terser()]
    },
    plugins: sharedPlugins
};

export default bundlesOnly ? [esm, umd] : [esm, umd, umdMin];
