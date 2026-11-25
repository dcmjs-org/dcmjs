import dcmjs from "../src/index.js";
import { createSampleDicom } from "./helper/sampleDicomPart10.js";

const { DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;
const { DicomMetadataListener } = dcmjs.utilities;

// Port of #657 (issue #643). A file with an Icon Image Sequence (0088,0200):
// the icon has its own Pixel Data inside the sequence item (PS3.3 C.7.6.1.1.6).
describe("AsyncDicomReader with Pixel Data inside a sequence item", () => {
    // The icon is one 2x2 frame, whatever the NumberOfFrames of the file
    const iconPixels = [1, 2, 3, 4];
    const frameBytes = 64 * 32; // the 64x32 8-bit frame of createSampleDicom

    const buildFile = numberOfFrames =>
        createSampleDicom({
            dict: {
                "00280008": { vr: "IS", Value: [String(numberOfFrames)] },
                "00880200": {
                    vr: "SQ",
                    Value: [
                        {
                            "00280002": { vr: "US", Value: [1] },
                            "00280010": { vr: "US", Value: [2] },
                            "00280011": { vr: "US", Value: [2] },
                            "00280100": { vr: "US", Value: [8] },
                            "7FE00010": {
                                vr: "OB",
                                Value: [new Uint8Array(iconPixels).buffer]
                            }
                        }
                    ]
                },
                "7FE00010": {
                    vr: "OB",
                    Value: [new ArrayBuffer(frameBytes * numberOfFrames)]
                }
            }
        });

    async function readAsync(buffer, options) {
        const reader = new AsyncDicomReader();
        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();
        await reader.readFile({
            listener: new DicomMetadataListener(),
            ...options
        });
        return reader.dict;
    }

    const bytes = value => Array.from(new Uint8Array(value));
    const iconFrames = dict =>
        dict["00880200"].Value[0]["7FE00010"].Value.map(frame =>
            frame.map(bytes)
        );

    it("reads the icon whole when untilTag is the Pixel Data tag", async () => {
        const dict = await readAsync(buildFile(3), { untilTag: "7FE00010" });

        expect(iconFrames(dict)).toEqual([[iconPixels]]);
        // The read still stops before the Pixel Data of the data set
        expect(dict["7FE00010"]).toBeUndefined();
        // The sync reader gives the same icon
        const sync = DicomMessage.readFile(buildFile(3), {
            untilTag: "7FE00010"
        }).dict;
        expect(sync["00880200"].Value[0]["7FE00010"].Value.map(bytes)).toEqual([
            iconPixels
        ]);
    });

    it("reads the icon as one frame whatever NumberOfFrames the file has", async () => {
        // 2 splits the 4 icon bytes in two frames, 3 does not divide them
        for (const frames of [1, 2, 3]) {
            const dict = await readAsync(buildFile(frames));
            expect(iconFrames(dict)).toEqual([[iconPixels]]);
            // The Pixel Data of the data set is still split by its frames
            expect(dict["7FE00010"].Value).toHaveLength(frames);
        }
    });
});
