import log from "../../log.js";
import { datasetToBlob } from "../../datasetToBlob.js";
import { DicomMessage } from "../../DicomMessage.js";
import { DicomMetaDictionary } from "../../DicomMetaDictionary.js";
import { Normalizer } from "../../normalizers.js";
import { RTSS as RTSSDerivation } from "../../derivations/index.js";

const RTSS = {
    generateMockRTSS
};

export default RTSS;

/**
 *
 * @typedef {Object} BrushData
 * @property {Object} toolState - The cornerstoneTools global toolState.
 * @property {Object[]} rtss - The cornerstoneTools segment metadata that corresponds to the
 *                                 seriesInstanceUid.
 */

const generateRTSSDefaultOptions = {
    includeSliceSpacing: true,
    rleEncode: true
};

/**
 * generateMockRTSS - Generates cornerstoneTools brush data, given a stack of
 * imageIds, images and the cornerstoneTools brushData.
 *
 * @param  {object[]} images An array of cornerstone images that contain the source
 *                           data under `image.data.byteArray.buffer`.
 * @param  {Object|Object[]} inputLabelmaps3D The cornerstone `Labelmap3D` object, or an array of objects.
 * @param  {Object} userOptions Options to pass to the segmentation derivation and `fillSegmentation`.
 * @returns {Blob}
 */
function generateMockRTSS(images, inputLabelmaps3D, userOptions = {}) {
    const isMultiFrame = images[0].imageId.includes("?frame");
    const rtss = _createRTSSFromImages(images, isMultiFrame, userOptions);

    console.log(images);

    return fillRTSS(rtss, inputLabelmaps3D, userOptions);
}

/**
 * fillRTSS - Fills a derived rtss dataset with array of cornerstoneTools `ROIContour` data.
 *
 * @param  {object[]} rtss An empty rtss derived dataset.
 * @param  {Object[]} inputROIContours The array of cornerstone `ROIContour` objects to add.
 * @param  {Object} userOptions Options object to override default options.
 * @returns {Blob}           description
 */
function fillRTSS(rtss, inputROIContours, userOptions = {}) {
    const options = Object.assign({}, generateRTSSDefaultOptions, userOptions);

    inputROIContours.forEach(roiContour => {
        rtss.addContour(roiContour);
    });

    const rtssBlob = datasetToBlob(rtss.dataset);
    return rtssBlob;
}

/**
 * _createRTSSFromImages - description
 *
 * @param  {Object[]} images    An array of the cornerstone image objects.
 * @param  {Boolean} isMultiframe Whether the images are multiframe.
 * @returns {Object}              The RTSS derived dataSet.
 */
function _createRTSSFromImages(images, isMultiframe, options) {
    const datasets = [];

    if (isMultiframe) {
        const image = images[0];
        const arrayBuffer = image.data.byteArray.buffer;

        const dicomData = DicomMessage.readFile(arrayBuffer);
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict);

        dataset._meta = DicomMetaDictionary.namifyDataset(dicomData.meta);

        datasets.push(dataset);
    } else {
        for (let i = 0; i < images.length; i++) {
            const image = images[i];
            const arrayBuffer = image.data.byteArray.buffer;
            const dicomData = DicomMessage.readFile(arrayBuffer);
            const dataset = DicomMetaDictionary.naturalizeDataset(
                dicomData.dict
            );

            dataset._meta = DicomMetaDictionary.namifyDataset(dicomData.meta);
            datasets.push(dataset);
        }
    }

    const multiframe = Normalizer.normalizeToDataset(datasets);

    return new RTSSDerivation([multiframe], options);
}
