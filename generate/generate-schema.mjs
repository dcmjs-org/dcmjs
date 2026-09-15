// D22 schema generator CLI — writes the committed artifacts.
// Usage: node generate/generate-schema.mjs
// Pure logic lives in buildCatalog.mjs (jest-importable, no import.meta);
// this shell owns filesystem paths and writes. Deterministic output.
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import prettier from "prettier";
import {
    buildCatalog,
    catalogSource,
    typesSource,
    jsonSchemaSource
} from "./buildCatalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
    const catalog = buildCatalog();
    mkdirSync(join(root, "src", "schema"), { recursive: true });
    // The catalog lives under src/, where the repo's prettier hooks reformat
    // on commit — emit prettier-formatted output so regeneration is diff-clean.
    const rulesPath = join(root, "src", "schema", "naturalizedRules.js");
    const prettierConfig = prettier.resolveConfig.sync(rulesPath) || {};
    writeFileSync(
        rulesPath,
        prettier.format(catalogSource(catalog), {
            ...prettierConfig,
            filepath: rulesPath
        })
    );
    console.log("wrote src/schema/naturalizedRules.js");
    mkdirSync(join(root, "types"), { recursive: true });
    writeFileSync(join(root, "types", "dcmjs-schema.d.ts"), typesSource(catalog));
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
