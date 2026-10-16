// Schema generator CLI — writes the committed artifacts.
// Usage: node generate/generate-schema.mjs
// Pure logic lives in buildCatalog.mjs (jest-importable, no import.meta);
// this shell owns filesystem paths and writes. Deterministic output.
// The attribute rules themselves are not written: src/schema/
// naturalizedRules.js derives them from the packed dictionary at runtime.
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
    buildCatalog,
    typesSource,
    jsonSchemaSource
} from "./buildCatalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
    const catalog = buildCatalog();
    mkdirSync(join(root, "types"), { recursive: true });
    writeFileSync(
        join(root, "types", "dcmjs-schema.d.ts"),
        typesSource(catalog)
    );
    console.log("wrote types/dcmjs-schema.d.ts");
    mkdirSync(join(root, "schema"), { recursive: true });
    writeFileSync(
        join(root, "schema", "naturalized.schema.json"),
        jsonSchemaSource(catalog)
    );
    console.log("wrote schema/naturalized.schema.json");
} catch (err) {
    console.error(`generate-schema FAILED: ${err.message}`);
    process.exit(1);
}
