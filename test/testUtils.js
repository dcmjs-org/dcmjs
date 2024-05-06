import fs from "fs";
import os from "os";
import path from "path";
import followRedirects from "follow-redirects";
import AdmZip from "adm-zip";
import { validationLog } from "./../src/log.js";

const { https } = followRedirects;

// Don't show validation errors, as those are normally tested
validationLog.level = 5;

function downloadToFile(url, filePath) {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(filePath);
        https
            .get(url, response => {
                response.pipe(fileStream);
                fileStream.on("finish", () => {
                    resolve(filePath);
                });
            })
            .on("error", reject);
    });
}

function unzip(zipFilePath, targetPath) {
    return new Promise((resolve, reject) => {
        try {
            // reading archives
            var zip = new AdmZip(zipFilePath);
            var zipEntries = zip.getEntries(); // an array of ZipEntry records
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
    if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath);
    }
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
        asyncDownloadMap.set(targetPath,filePromise);
    }
    // This returns immediately if filePromise is undefined - eg if the file already downloaded.
    await filePromise;
    return targetPath;
}

export { getTestDataset, getZippedTestDataset };
