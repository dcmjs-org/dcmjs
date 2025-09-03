import fs from "fs";

import dcmjs from "../src/index.js";
import { getTestDataset } from "./testUtils.js";

const { NormalizedDictCreator, DicomMessage } = dcmjs.data;

const url =
    "https://github.com/dcmjs-org/data/releases/download/binary-parsing-stressors/large-private-tags.dcm";

describe("Streaming Parsing", () => {
    let dcmPath, buffer;

    beforeAll(async () => {
        dcmPath = await getTestDataset(url, "large-private-tags.dcm");
        console.warn("dcmPath=", dcmPath);
        buffer = fs.readFileSync(dcmPath).buffer;
    });

    it("Reads partial streamed data", async () => {
        const options = {
            stream: true
        };

        options.dictCreator = new NormalizedDictCreator(DicomMessage, options);

        let dicomDict = DicomMessage.readFile(buffer.slice(0, 128), options);
        expect(dicomDict).toBe(false);

        const { stream } = options;
        expect(stream.hasData(0, 128)).toBe(true);
        expect(stream.hasData(0, 132)).toBe(false);

        dicomDict = DicomMessage.readFile(buffer.slice(128, 132), options);
        expect(dicomDict).toBe(false);
        expect(stream.hasData(0, 132)).toBe(false);

        dicomDict = DicomMessage.readFile(buffer.slice(132, 340), options);
        expect(dicomDict).toBe(false);
        expect(options.dictCreator.fmi).toBeTruthy();
        expect(stream.hasData(132, 340)).toBe(false);

        options.stream.addBuffer(buffer.slice(340, buffer.byteLength));
        options.stream.setComplete();
        // Should read the rest now
        dicomDict = DicomMessage.readFile(null, options);
        expect(dicomDict.dict).toBeTruthy();
    });

    /** Warning - this is fairly slow to run as it chunks things up into tiny bits */
    it("Reads data in streamed 15 byte chunks", async () => {
        const chunkLength = 15;
        const options = {
            stream: true
        };

        options.dictCreator = new NormalizedDictCreator(DicomMessage, options);

        let iNext = 0;
        for (let i = 0; i < buffer.byteLength; i = iNext) {
            iNext = Math.min(i + chunkLength, buffer.byteLength);
            const dicomDict = DicomMessage.readFile(
                buffer.slice(i, iNext),
                options
            );
            expect(dicomDict).toBe(false);
        }
        options.stream.setComplete();
        // Should read the rest now
        const dicomDict = DicomMessage.readFile(null, options);
        expect(dicomDict.dict).toBeTruthy();
    });
});
