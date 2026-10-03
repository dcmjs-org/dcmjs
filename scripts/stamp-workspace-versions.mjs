// Writes one version into every publishable package.json in the workspace.
// semantic-release computes the version; this script spreads it, so all
// packages release in lockstep. See RELEASE_PLAN.md, section 9.
//
// Usage: node scripts/stamp-workspace-versions.mjs 1.0.0-beta.1 [rootDir]
// rootDir defaults to the repository root; tests pass a scratch directory.

import fs from "fs";
import path from "path";
import process from "process";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(
        `usage: stamp-workspace-versions.mjs <semver> [rootDir] (got ${JSON.stringify(
            version
        )})`
    );
    process.exit(1);
}

const repoRoot = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function candidatePackageFiles() {
    const files = [path.join(repoRoot, "package.json")];
    const packagesDir = path.join(repoRoot, "packages");
    if (fs.existsSync(packagesDir)) {
        for (const entry of fs.readdirSync(packagesDir)) {
            const file = path.join(packagesDir, entry, "package.json");
            if (fs.existsSync(file)) {
                files.push(file);
            }
        }
    }
    return files;
}

const stamped = [];
const skipped = [];
for (const file of candidatePackageFiles()) {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    if (pkg.private === true) {
        skipped.push(pkg.name ?? file);
        continue;
    }
    pkg.version = version;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 4) + "\n");
    stamped.push(pkg.name ?? file);
}

console.log(`stamped ${version}: ${stamped.join(", ")}`);
if (skipped.length > 0) {
    console.log(`skipped (private): ${skipped.join(", ")}`);
}
