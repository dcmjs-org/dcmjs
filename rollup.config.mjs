import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
// import globals from "rollup-plugin-node-globals";
// import builtins from "rollup-plugin-node-builtins";
import commonjs from "@rollup/plugin-commonjs";
// import babelRuntime from "@rollup/plugin-transform-runtime"
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import { readFileSync } from "fs";

const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8")
);

export default {
    input: "src/index.js",
    output: [
        {
            file: pkg.main,
            format: "umd",
            name: "dcmjs",
            sourcemap: true
        },
        {
            file: pkg.module,
            format: "es",
            sourcemap: true
        }
    ],
    plugins: [
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
        //  globals(),
        //builtins(),
        // babelRuntime(),
        babel({
            exclude: "node_modules/**"
        }),
        json()
    ]
};
