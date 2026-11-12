/**
 * PR #597: https://github.com/dcmjs-org/dcmjs/pull/597
 *   AsyncDicomReader skipped a command group (0000,xxxx) element with
 *   stream.increment(tagObj.length); Tag has no length, so the offset
 *   became NaN and the read stopped silently, dropping all later tags.
 */
import dcmjs from "../../src/index.js";
import { createSampleDicom } from "../helper/sampleDicomPart10.js";
import { TagHex } from "../../src/constants/dicom.js";

const { AsyncDicomReader } = dcmjs.async;

it("async reader skips a command group element and reads the tags after it", async () => {
    const buffer = createSampleDicom({
        dict: { "00000002": { vr: "UI", Value: ["1.2.3"] } }
    });
    const reader = new AsyncDicomReader();
    reader.stream.addBuffer(buffer);
    reader.stream.setComplete();
    const { dict } = await reader.readFile();

    expect(dict["00000002"]).toBeUndefined();
    expect(dict[TagHex.Rows]).toBeDefined();
    expect(dict[TagHex.PixelData]).toBeDefined();
});
