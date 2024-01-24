import "regenerator-runtime/runtime.js";
import fs from "fs";
import Segmentation_4X from "../src/adapters/Cornerstone/Segmentation_4X"
import { getTestDataset } from "./testUtils.js";

const mockMetadataProvider = {
    get: (type, imageId) => {
        // Unlike CT, is missing coordinate system such as frameOfReferenceUID or rowCosines attributes
        if (imageId === "mg://1") {
            return {
                seriesInstanceUID: "1.2.840.113681.167838594.1562401072.4432.2070.71100000",
                rows: 3328,
                columns: 2560,
                pixelSpacing: [0.065238, 0.065238],
                rowPixelSpacing: 0.065238,
                columnPixelSpacing: 0.065238,
                columnCosines: null,
                frameOfReferenceUID: undefined,
                imageOrientationPatient: undefined,
                imagePositionPatient: undefined,
                rowCosines: null,
                sliceLocation: undefined,
                sliceThickness: undefined
            };
        }
    }
}

it("Can generate tool state (4X) with SEG sourcing MG images without throwing any errors", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/mg-seg/seg-test-SEG.dcm";
    const dcmPath = await getTestDataset(url, "seg-test-SEG.dcm")
    const arrayBuffer = fs.readFileSync(dcmPath).buffer

    expect(
        () => {
            Segmentation_4X.generateToolState(
                ["mg://1"],
                arrayBuffer,
                mockMetadataProvider
            )
        },
    ).not.toThrowError();

});