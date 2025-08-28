import fs from "fs";

import dcmjs from "../src/index.js";
import { getTestDataset } from "./testUtils.js";

const { NormalizedDictCreator, DicomMessage } = dcmjs.data;

it("Reads already normalized data", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/binary-parsing-stressors/large-private-tags.dcm";
    const dcmPath = await getTestDataset(url, "large-private-tags.dcm");
    const options = {};
    options.dictCreator = new NormalizedDictCreator(DicomMessage, options);
    const dicomDict = DicomMessage.readFile(
        fs.readFileSync(dcmPath).buffer,
        options
    );

    const { dict } = dicomDict;

    expect(dict.PixelData).toBeInstanceOf(Array);
    expect(dict.PixelData.length).toEqual(130);
    expect(dict.PixelData[0]).toBeInstanceOf(ArrayBuffer);

    expect(dict["GEMS_Ultrasound_ImageGroup_001:6003"]).toBeTruthy();
    expect(
        dict["GEMS_Ultrasound_ImageGroup_001:6003"]["60030012"]
    ).toBeTruthy();
});
