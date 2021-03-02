import babel from "rollup-plugin-babel";
import resolve from "rollup-plugin-node-resolve";
import globals from "rollup-plugin-node-globals";
import builtins from "rollup-plugin-node-builtins";
import commonjs from "rollup-plugin-commonjs";
import json from "rollup-plugin-json";
import legacy from "rollup-plugin-legacy";
import pkg from "./package.json";

export default {
    input: "src/index.js",
    output: [
        {
            file: pkg.main,
            format: "umd",
            name: "dcmjs",
            sourcemap: true,
            compact: false,
            minifyInternalExports: false
        },
        {
            file: pkg.module,
            format: "es",
            sourcemap: true
        }
    ],
    onwarn(warning, warn) {
        if (warning.code === "EVAL") return;
        warn(warning);
    },
    plugins: [
        legacy({
            "libs/jpeg.js": "JpegImage",
            "libs/charLS-FixedMemory-browser.js": "CharLS",
            "libs/openJPEG-FixedMemory-browser.js": "OpenJPEG"
        }),
        resolve({
            browser: true
        }),
        commonjs(),
        globals({ dirname: false }),
        builtins(),
        babel({
            runtimeHelpers: true,
            exclude: "node_modules/**"
        }),
        json()
    ]
};
