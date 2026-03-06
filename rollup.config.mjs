import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
// import globals from "rollup-plugin-node-globals";
// import builtins from "rollup-plugin-node-builtins";
import commonjs from "@rollup/plugin-commonjs";
// import babelRuntime from "@rollup/plugin-transform-runtime"
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import { readFileSync } from "fs";

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
        browser: true
    }),
    commonjs(),
    babel({
        babelHelpers: "bundled",
        exclude: "node_modules/**"
    }),
    json()
];

export default [
    {
        input: "src/index.js",
        output: {
            dir: "build",
            format: "es",
            entryFileNames: "dcmjs.es.js",
            chunkFileNames: "dcmjs.[name]-[hash].js",
            sourcemap: true
        },
        plugins: sharedPlugins
    },
    {
        input: "src/index.js",
        output: {
            file: pkg.main,
            format: "umd",
            name: "dcmjs",
            sourcemap: true
        },
        plugins: sharedPlugins
    },
    {
        input: "src/index.js",
        output: {
            file: pkg.main.replace(/\.js$/, ".min.js"),
            format: "umd",
            name: "dcmjs",
            sourcemap: true,
            plugins: [terser()]
        },
        plugins: sharedPlugins
    }
];
