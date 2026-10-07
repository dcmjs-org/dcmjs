// Covers scripts/stamp-workspace-versions.mjs, the release step that
// writes one computed version into every publishable package.json.
// See RELEASE_PLAN.md, section 9.
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const script = path.join(
    __dirname,
    "..",
    "scripts",
    "stamp-workspace-versions.mjs"
);

function makeScratchWorkspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-test-"));
    const write = (rel, pkg) => {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(pkg, null, 4) + "\n");
    };
    write("package.json", { name: "root-pkg", version: "0.0.0" });
    write("packages/public-one/package.json", {
        name: "@scope/public-one",
        version: "0.0.0"
    });
    write("packages/private-one/package.json", {
        name: "@scope/private-one",
        version: "0.0.0",
        private: true
    });
    return root;
}

function readVersion(root, rel) {
    return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")).version;
}

describe("stamp-workspace-versions", () => {
    it("stamps the root and public packages, and skips private ones", () => {
        const root = makeScratchWorkspace();
        const output = execFileSync("node", [script, "1.0.0-beta.7", root], {
            encoding: "utf8"
        });

        expect(readVersion(root, "package.json")).toBe("1.0.0-beta.7");
        expect(readVersion(root, "packages/public-one/package.json")).toBe(
            "1.0.0-beta.7"
        );
        expect(readVersion(root, "packages/private-one/package.json")).toBe(
            "0.0.0"
        );
        expect(output).toContain("root-pkg");
        expect(output).toContain("@scope/public-one");
        expect(output).toContain("skipped (private): @scope/private-one");
    });

    it("rejects a string that is not a version", () => {
        const root = makeScratchWorkspace();
        expect(() =>
            execFileSync("node", [script, "not-a-version", root], {
                encoding: "utf8",
                stdio: "pipe"
            })
        ).toThrow();
        expect(readVersion(root, "package.json")).toBe("0.0.0");
    });
});
