// Validates the codemod.yaml and workflow.yaml of each registry package.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(import.meta.url), "../..");

function findPackages(directory, found = []) {
    for (const entry of readdirSync(directory)) {
        const path = resolve(directory, entry);
        if (statSync(path).isDirectory()) findPackages(path, found);
        else if (entry === "codemod.yaml") found.push(directory);
    }
    return found;
}

for (const directory of findPackages(resolve(packageRoot, "registry")).sort()) {
    console.log(`Validating ${relative(packageRoot, directory)}`);
    const result = spawnSync(
        "npx",
        [
            "codemod",
            "workflow",
            "validate",
            "--disable-analytics",
            "-w",
            directory
        ],
        { stdio: "inherit", shell: process.platform === "win32" }
    );
    if (result.status !== 0) process.exit(result.status || 1);
}
