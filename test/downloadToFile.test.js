import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { downloadToFile } from "./testUtils";

// Exercises the fixture-download guard against a local HTTP server, so no
// real network access is needed. Each route scripts a response sequence.
describe("downloadToFile", () => {
    let server;
    let baseUrl;
    let tmpDir;
    let requestCounts;

    beforeAll(done => {
        requestCounts = {};
        server = http.createServer((req, res) => {
            requestCounts[req.url] = (requestCounts[req.url] || 0) + 1;
            if (req.url === "/ok.dcm") {
                res.writeHead(200);
                res.end("DICM-PAYLOAD");
            } else if (req.url === "/missing.dcm") {
                res.writeHead(404);
                res.end("Not Found");
            } else if (req.url === "/flaky.dcm") {
                if (requestCounts[req.url] === 1) {
                    res.writeHead(503);
                    res.end("upstream hiccup");
                } else {
                    res.writeHead(200);
                    res.end("DICM-PAYLOAD");
                }
            } else if (req.url === "/redirect.dcm") {
                res.writeHead(302, { Location: `${baseUrl}/ok.dcm` });
                res.end();
            } else {
                res.writeHead(500);
                res.end("boom");
            }
        });
        server.listen(0, "127.0.0.1", () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            done();
        });
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dcmjs-dl-test-"));
    });

    afterAll(done => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        server.close(done);
    });

    it("saves the body on a 200 response", async () => {
        const target = path.join(tmpDir, "ok.dcm");
        await downloadToFile(`${baseUrl}/ok.dcm`, target);
        expect(fs.readFileSync(target, "utf8")).toBe("DICM-PAYLOAD");
    });

    it("follows redirects to the real payload", async () => {
        const target = path.join(tmpDir, "redirected.dcm");
        await downloadToFile(`${baseUrl}/redirect.dcm`, target);
        expect(fs.readFileSync(target, "utf8")).toBe("DICM-PAYLOAD");
    });

    it("rejects on a non-2xx status instead of saving the error body", async () => {
        const target = path.join(tmpDir, "missing.dcm");
        await expect(
            downloadToFile(`${baseUrl}/missing.dcm`, target)
        ).rejects.toThrow(/404.*missing\.dcm|missing\.dcm.*404/);
        // The poisoned-cache failure mode: an error page saved as a .dcm
        // makes every later run fail far away from the real cause.
        expect(fs.existsSync(target)).toBe(false);
    });

    it("retries once and succeeds after a transient failure", async () => {
        const target = path.join(tmpDir, "flaky.dcm");
        await downloadToFile(`${baseUrl}/flaky.dcm`, target);
        expect(requestCounts["/flaky.dcm"]).toBe(2);
        expect(fs.readFileSync(target, "utf8")).toBe("DICM-PAYLOAD");
    });
});
