// Builds one workspace package (the package in the current directory) into
// dist/index.mjs and dist/index.cjs. Run from a package directory through its
// "build" script. Every bare import (other @dcmjs-org packages, pako,
// loglevel) stays external, so each package ships only its own code.
import resolve from "@rollup/plugin-node-resolve";
import path from "path";

const isExternal = id => !id.startsWith(".") && !path.isAbsolute(id);

export default {
    input: "src/index.js",
    external: isExternal,
    output: [
        {
            file: "dist/index.mjs",
            format: "es",
            sourcemap: true
        },
        {
            file: "dist/index.cjs",
            format: "cjs",
            exports: "named",
            sourcemap: true
        }
    ],
    plugins: [resolve()]
};
