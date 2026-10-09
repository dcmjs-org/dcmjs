import fs from "fs";
import os from "os";
import path from "path";
import followRedirects from "follow-redirects";
import AdmZip from "adm-zip";
import { validationLog } from "./../src/log.js";

const { http, https } = followRedirects;

// Don't show validation errors, as those are normally tested
validationLog.setLevel(5);

function downloadAttempt(url, filePath) {
    return new Promise((resolve, reject) => {
        // follow-redirects handles 3xx hops; http is only hit by local tests.
        const transport = url.startsWith("http:") ? http : https;
        // Stream into a worker-private name and rename into place once
        // complete. The rename is atomic, so a parallel jest worker checking
        // fs.existsSync(filePath) can never observe a half-written fixture.
        const partialPath = `${filePath}.${process.pid}.partial`;
        const fail = error => {
            fs.rmSync(partialPath, { force: true });
            reject(error);
        };
        transport
            .get(url, response => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    response.resume();
                    fail(
                        new Error(
                            `Download of ${url} failed with HTTP status ${response.statusCode}`
                        )
                    );
                    return;
                }
                const fileStream = fs.createWriteStream(partialPath);
                response.pipe(fileStream);
                fileStream.on("finish", () => {
                    try {
                        fs.renameSync(partialPath, filePath);
                        resolve(filePath);
                    } catch (renameError) {
                        fail(renameError);
                    }
                });
                fileStream.on("error", fail);
                response.on("error", fail);
            })
            .on("error", fail);
    });
}

// Downloads url to filePath, failing loudly (instead of saving an error body
// or a truncated stream that would poison the fixture cache) and retrying
// once to absorb transient upstream hiccups.
async function downloadToFile(url, filePath, retries = 1) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await downloadAttempt(url, filePath);
        } catch (error) {
            if (attempt >= retries) {
                throw error;
            }
        }
    }
}

function unzip(zipFilePath, targetPath) {
    return new Promise((resolve, reject) => {
        try {
            // reading archives
            var zip = new AdmZip(zipFilePath);
            // extracts everything
            zip.extractAllTo(targetPath, true);
            resolve();
        } catch (e) {
            reject(e);
        }
    });

    // This code is broken in Node 18+, creating garbage output
    // return new Promise(resolve => {
    //       fs.createReadStream(zipFilePath).pipe(
    //           unzipper.Extract({ path: targetPath }).on("close", resolve)
    //       );
    //   });
}

function ensureTestDataDir() {
    var targetPath = path.join(os.tmpdir(), "dcmjs-test");
    // recursive:true is idempotent, so parallel jest workers cannot race
    // each other into an EEXIST between an exists check and the mkdir.
    fs.mkdirSync(targetPath, { recursive: true });
    return targetPath;
}

async function getZippedTestDataset(url, filename, unpackDirectory) {
    const dir = ensureTestDataDir();
    const targetPath = path.join(dir, filename);
    const unpackPath = path.join(dir, unpackDirectory);
    if (!fs.existsSync(unpackPath)) {
        await downloadToFile(url, targetPath);
        await unzip(targetPath, unpackPath);
    }
    return unpackPath;
}

/**
 * Stores the required downloads to prevent async reading before download completed.
 */
const asyncDownloadMap = new Map();

async function getTestDataset(url, filename) {
    const dir = ensureTestDataDir();
    const targetPath = path.join(dir, filename);
    let filePromise = asyncDownloadMap.get(targetPath);
    if (!filePromise && !fs.existsSync(targetPath)) {
        filePromise = downloadToFile(url, targetPath);
        asyncDownloadMap.set(targetPath, filePromise);
    }
    // This returns immediately if filePromise is undefined - eg if the file already downloaded.
    await filePromise;
    return targetPath;
}

// Absolute path to a committed DICOM fixture in packages/fixtures/dicom.
function fixturePath(name) {
    return path.join(__dirname, "..", "packages", "fixtures", "dicom", name);
}

// Reads a file into a standalone ArrayBuffer. Node may return small files
// inside a larger shared memory pool, so taking `.buffer` directly can hand
// back the pool (with the file at a nonzero offset) instead of the file.
function readFileAsArrayBuffer(filePath) {
    const buffer = fs.readFileSync(filePath);
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );
}

export {
    downloadToFile,
    getTestDataset,
    getZippedTestDataset,
    readFileAsArrayBuffer,
    fixturePath
};
