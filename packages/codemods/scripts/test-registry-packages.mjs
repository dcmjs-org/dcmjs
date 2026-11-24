// Runs the fixture tests of each registry package: for each step of
// workflow.yaml, the fixtures in tests/<language> run with the script and the
// language of that step.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(import.meta.url), "../..");
const registryRoot = resolve(packageRoot, "registry");

function findPackages(directory, found = []) {
    for (const entry of readdirSync(directory)) {
        const path = resolve(directory, entry);
        if (statSync(path).isDirectory()) findPackages(path, found);
        else if (entry === "workflow.yaml") found.push(directory);
    }
    return found;
}

/** The [script, language] pairs of the js-ast-grep steps of a workflow. */
function steps(directory) {
    const workflow = readFileSync(resolve(directory, "workflow.yaml"), "utf8");
    const pairs = workflow.matchAll(
        /js_file:\s*['"]?([^'"\s]+)['"]?\s+language:\s*['"]?(\w+)/g
    );
    return [...new Map([...pairs].map(([, js, lang]) => [lang, js]))];
}

let failed = false;
let ran = 0;
for (const directory of findPackages(registryRoot).sort()) {
    for (const [language, script] of steps(directory)) {
        const tests = `tests/${language}`;
        if (!existsSync(resolve(directory, tests))) continue;
        console.log(`\n${relative(packageRoot, directory)}: ${language}`);
        const result = spawnSync(
            "npx",
            [
                "codemod",
                "jssg",
                "test",
                "--disable-analytics",
                "-l",
                language,
                script,
                tests
            ],
            {
                cwd: directory,
                stdio: "inherit",
                shell: process.platform === "win32"
            }
        );
        ran++;
        failed ||= result.status !== 0;
    }
}

if (!ran) {
    console.error("No fixture tests found");
    process.exit(1);
}
process.exit(failed ? 1 : 0);
