// Copies the UMD build of @dcmjs-org/dcmjs, so that unpkg.com/dcmjs and
// jsdelivr serve a file that runs in a browser (the "unpkg" field).
import fs from "node:fs";

const from = new URL("../../build/", import.meta.url);
const to = new URL("./dist/", import.meta.url);
fs.mkdirSync(to, { recursive: true });
for (const file of ["dcmjs.js", "dcmjs.js.map"]) {
    fs.copyFileSync(new URL(file, from), new URL(file, to));
}
