export default class Segmentation {
  constructor() {}

  static generateToolState(stackOfImages, toolState) {}

  static _setSegMetadata(segIndex, metadata) {
    modules.brush.setters.metadata(
      this._seriesInfo.seriesInstanceUid,
      segIndex,
      metadata
    );
  }

  static readToolState(imageIds, arrayBuffer) {
    dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
    let dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
      dicomData.dict
    );
    dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(
      dicomData.meta
    );
    multiframe = dcmjs.normalizers.Normalizer.normalizeToDataset([dataset]);

    const segmentSequence = multiframe.SegmentSequence;

    const segMetadata = {};

    if (Array.isArray(segmentSequence)) {
      for (let i = 0; i < segmentSequence.length; i++) {
        const segment = segmentSequence[i];

        this._setSegMetadata(segMetadata, i, segment);
        /*
        for (let j = 0; j < dimensions.cube; j++) {
          mask[j] = pixelData[i * dimensions.cube + j];
        }
        */
      }
    } else {
      // Only one segment, will be stored as an object.
      const segment = segmentSequence;

      Segmentation._setSegMetadata(segMetadata, 0, segment);
      /*
      for (let j = 0; j < dimensions.cube; j++) {
        mask[j] = pixelData[j];
      }
      */
    }

    // TODO -> return seg metadata and brush tool data.

    /*
    const { globalImageIdSpecificToolStateManager } = cornerstoneTools;

    for (let i = 0; i < imageIds.length; i++) {
      const imageId = imageIds[i];
      const byteOffset = width * height * i;
      const length = width * height;
      const slicePixelData = new Uint8ClampedArray(buffer, byteOffset, length);

      const toolData = [];
      toolData[segmentationIndex] = {
        pixelData: slicePixelData,
        invalidated: true
      };

      const toolState =
        globalImageIdSpecificToolStateManager.saveImageIdToolState(imageId) ||
        {};

      toolState[toolType] = {
        data: toolData
      };

      globalImageIdSpecificToolStateManager.restoreImageIdToolState(
        imageId,
        toolState
      );
    }
    */
  }
}
