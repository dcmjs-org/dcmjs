export default class Segmentation {
  constructor() {}

  static generateToolState(stackOfImages, toolState) {}

  static readToolState(dataset) {
    // TODO: Check if the dataset is a seg.
    /*
    if (dataset) {
      throw new Error("This package is only meant to ");
    }
    */

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
  }
}
