import fs from "fs";

import dcmjs from "../src/index.js";
import { getTestDataset } from "./testUtils.js";

const { NormalizedDictCreator, DicomMessage, ReadBufferStream } = dcmjs.data;

const url =
    "https://github.com/dcmjs-org/data/releases/download/binary-parsing-stressors/large-private-tags.dcm";

describe("Streaming Parsing", () => {
    let dcmPath, buffer;

    beforeAll(async () => {
        dcmPath = await getTestDataset(url, "large-private-tags.dcm");
        buffer = fs.readFileSync(dcmPath).buffer;
    });

    it("Reads partial streamed data", async () => {
        const options = {
            stream: true
        };

        options.dictCreator = new NormalizedDictCreator(DicomMessage, options);

        let dicomDict = DicomMessage.readFile(buffer.slice(0, 128), options);

        expect(dicomDict).toBe(false);

        dicomDict = DicomMessage.readFile(buffer.slice(128, 132), options);
        expect(dicomDict).toBe(false);

        options.stream.addBuffer(buffer.slice(132,-1));
        options.stream.setComplete();

        // Should read the rest now
        dicomDict = DicomMessage.readFile(null, options);
        expect(dicomDict.dict).toBeTruthy();
    });
});
