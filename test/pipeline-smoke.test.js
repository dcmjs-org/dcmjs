// Exists to verify the CI pipeline on the 1.0-beta branch: if this suite
// runs and reports on a pull request, the checks are wired correctly.
// See RELEASE_PLAN.md, section 6, step 0.
import fs from "fs";
import dcmjs from "../src/index.js";

describe("pipeline smoke test", () => {
    it("finds the DICM marker in a sample file", () => {
        const file = fs.readFileSync("test/sample-sr.dcm");
        const marker = file.subarray(128, 132).toString("ascii");
        expect(marker).toBe("DICM");
    });

    it("reads the sample file end to end", () => {
        const file = fs.readFileSync("test/sample-sr.dcm");
        const arrayBuffer = file.buffer.slice(
            file.byteOffset,
            file.byteOffset + file.byteLength
        );
        const dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
        const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
            dicomData.dict
        );
        expect(dataset.SOPClassUID).toBeDefined();
    });
});
