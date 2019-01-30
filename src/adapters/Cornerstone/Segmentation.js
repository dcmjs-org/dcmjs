export default class Segmentation {
  constructor() {}

  static generateToolState(stackOfImages, toolState) {}

  static _setSegMetadata(segMetadata, idx, segment) {
    segMetadata[idx] = segment;

    modules.brush.setters.metadata(
      this._seriesInfo.seriesInstanceUid,
      idx,
      segment
    );
  }

  static _addOneSegToCornerstoneToolState() {}

  static readToolState(imageIds, arrayBuffer) {
    dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
    let dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
      dicomData.dict
    );
    dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(
      dicomData.meta
    );
    const multiframe = dcmjs.normalizers.Normalizer.normalizeToDataset([
      dataset
    ]);

    const dims = {
      x: multiframe.Columns,
      y: multiframe.Rows,
      z: imageIds.length,
      xy: multiframe.Columns * multiframe.Rows,
      xyz: multiframe.Columns * multiframe.Rows * imageIds.length
    };

    const segmentSequence = multiframe.SegmentSequence;
    const pixelData = dcmjs.data.BitArray.unpack(multiframe.PixelData);

    //console.log(segmentSequence);

    //console.log(multiframe);

    const segMetadata = [];

    const toolState = {};

    if (Array.isArray(segmentSequence)) {
      const segCount = segmentSequence.length;

      for (let z = 0; z < imageIds.length; z++) {
        const imageId = imageIds[z];

        const imageIdSpecificToolState = {};

        imageIdSpecificToolState.brush = {};
        imageIdSpecificToolState.brush.data = [];

        const brushData = imageIdSpecificToolState.brush.data;

        for (let i = 0; i < segCount; i++) {
          brushData[i] = {
            invalidated: true,
            pixelData: new Uint8ClampedArray(dims.x * dims.y)
          };
        }

        toolState[imageId] = imageIdSpecificToolState;
      }

      for (let segIndex = 0; segIndex < segmentSequence.length; segIndex++) {
        segMetadata.push(segmentSequence[segIndex]);

        for (let z = 0; z < imageIds.length; z++) {
          const imageId = imageIds[z];

          const cToolsPixelData =
            toolState[imageId].brush.data[segIndex].pixelData;

          for (let p = 0; p < dims.xy; p++) {
            cToolsPixelData[p] =
              pixelData[segIndex * dims.xyz + z * dims.xy + p];
          }
        }
      }
    } else {
      // Only one segment, will be stored as an object.
      segMetadata.push(segmentSequence);

      const segIndex = 0;

      for (let z = 0; z < imageIds.length; z++) {
        const imageId = imageIds[z];

        const imageIdSpecificToolState = {};

        imageIdSpecificToolState.brush = {};
        imageIdSpecificToolState.brush.data = [];
        imageIdSpecificToolState.brush.data[segIndex] = {
          invalidated: true,
          pixelData: new Uint8ClampedArray(dims.x * dims.y)
        };

        const cToolsPixelData =
          imageIdSpecificToolState.brush.data[segIndex].pixelData;

        for (let p = 0; p < dims.xy; p++) {
          cToolsPixelData[p] = pixelData[z * dims.xy + p];
        }

        toolState[imageId] = imageIdSpecificToolState;
      }
    }

    //console.log(toolState);

    // TODO -> return seg metadata and brush tool data.

    return { toolState, segMetadata };
  }
}
