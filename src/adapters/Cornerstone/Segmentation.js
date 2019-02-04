import { BitArray } from "../../bitArray.js";
import { datasetToBlob } from "../../datasetToBlob.js";
import { DicomMessage } from "../../DicomMessage.js";
import { DicomMetaDictionary } from "../../DicomMetaDictionary.js";
import { Normalizer } from "../../normalizers.js";
import { Segmentation as SegmentationDerivation } from "../../derivations.js";
import ndarray from 'ndarray';
import cwise from 'cwise';

const Segmentation = {
  generateToolState,
  readToolState
};

export default Segmentation;

/**
 *
 * @typedef {Object} BrushData
 * @property {Object} toolState - The cornerstoneTools global toolState.
 * @property {Object[]} segments - The cornerstoneTools segment metadata that corresponds to the
 *                                 seriesInstanceUid.
 */

/**
 * generateToolState - Generates cornerstoneTools brush data, given a stack of
 * imageIds, images and the cornerstoneTools brushData.
 *
 * @param  {object[]} images    An array of the cornerstone image objects.
 * @param  {BrushData} brushData and object containing the brushData.
 * @returns {type}           description
 */
function generateToolState(images, brushData) {
  // NOTE: here be dragons. Currently if a brush has been used and then erased,
  // This will flag up as a segmentation, even though its full of zeros.
  // Fixing this cleanly really requires an update of cornerstoneTools?

  const { toolState, segments } = brushData;

  // Calculate the dimensions of the data cube.
  const image0 = images[0];

  const dims = {
    x: image0.columns,
    y: image0.rows,
    z: images.length
  };

  dims.xy = dims.x * dims.y;
  dims.xyz = dims.xy * dims.z;

  const isMultiframe = image0.imageId.includes("?frame");

  const seg = _createSegFromImages(images, isMultiframe);

  const numSegments = _addMetaDataToSegAndGetSegCount(seg, segments);

  if (!numSegments) {
    throw new Warning("No segments to export!");
  }

  // Create an array of ints as long as the number of
  // Voxels * the number of segments.
  const cToolsPixelData = _parseCornerstoneToolsAndExtractSegs(
    images,
    toolState,
    dims,
    segments,
    numSegments
  );

  const dataSet = seg.dataset;

  // Re-define the PixelData ArrayBuffer to be the correct length
  // => segments * rows * columns * slices / 8 (As 8 bits/byte)
  seg.dataset.PixelData = new ArrayBuffer((numSegments * dims.xyz) / 8);

  const pixelDataUint8View = new Uint8Array(seg.dataset.PixelData);
  const bitPackedcToolsData = BitArray.pack(cToolsPixelData);

  for (let i = 0; i < pixelDataUint8View.length; i++) {
    pixelDataUint8View[i] = bitPackedcToolsData[i];
  }

  const segBlob = datasetToBlob(seg.dataset);

  return segBlob;
}

function _parseCornerstoneToolsAndExtractSegs(
  images,
  toolState,
  dims,
  segments,
  numSegments
) {
  const cToolsPixelData = new Uint8ClampedArray(dims.xyz * numSegments);

  let currentSeg = 0;

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    if (!segments[segIdx]) {
      continue;
    }

    _extractOneSeg(
      segIdx,
      images,
      toolState,
      cToolsPixelData,
      currentSeg,
      dims
    );

    currentSeg++;
  }

  return cToolsPixelData;
}

function _extractOneSeg(
  segIdx,
  images,
  toolState,
  cToolsPixelData,
  currentSeg,
  dims
) {
  for (let z = 0; z < images.length; z++) {
    const imageId = images[z].imageId;
    const imageIdSpecificToolState = toolState[imageId];

    if (
      imageIdSpecificToolState &&
      imageIdSpecificToolState.brush &&
      imageIdSpecificToolState.brush.data
    ) {
      const pixelData = imageIdSpecificToolState.brush.data[segIdx].pixelData;

      for (let p = 0; p < dims.xy; p++) {
        cToolsPixelData[currentSeg * dims.xyz + z * dims.xy + p] = pixelData[p];
      }
    }
  }
}

function _addMetaDataToSegAndGetSegCount(seg, segments) {
  let numSegments = 0;

  for (let i = 0; i < segments.length; i++) {
    if (segments[i]) {
      numSegments++;

      seg.addSegment(segments[i]);
    }
  }

  return numSegments;
}

/**
 * _createSegFromImages - description
 *
 * @param  {Object[]} images    An array of the cornerstone image objects.
 * @param  {Boolean} isMultiframe Whether the images are multiframe.
 * @returns {Object}              The Seg derived dataSet.
 */
function _createSegFromImages(images, isMultiframe) {
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
      const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict);

      dataset._meta = DicomMetaDictionary.namifyDataset(dicomData.meta);
      datasets.push(dataset);
    }
  }

  const multiframe = Normalizer.normalizeToDataset(datasets);

  return new SegmentationDerivation([multiframe]);
}

/**
 * Create Cornerstone Tools Brush Tool State data
 * given a specific input pixel data and a segment index
 *
 * @param {Object} pixelDataNDArray
 * @param {Number} segIdx
 * @return {Uint8ClampedArray} Pixel data for the brush tool
 */
function getBrushToolState(pixelDataNDArray, segIdx = 0, sliceIdx = 0) {
  const slicePixelData = pixelDataNDArray.pick(null, null, sliceIdx, segIdx);

  const binarize = cwise({
    args: ["array"],
    body: function(a) {
      a !== 0
    }
  })

  return binarize(slicePixelData);
}

/**
 * readToolState - Given a set of cornrstoneTools imageIds and a SEG, derive
 * cornerstoneTools toolState and brush metadata.
 *
 * @param  {string[]} imageIds    An array of the imageIds.
 * @param  {ArrayBuffer} arrayBuffer The SEG arrayBuffer.
 * @returns {Object}  The toolState and an object from which the
 *                    segment metadata can be derived.
 */
function readToolState(imageIds, arrayBuffer) {
  const dicomData = DicomMessage.readFile(arrayBuffer);
  const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict);
  dataset._meta = DicomMetaDictionary.namifyDataset(dicomData.meta);

  const multiframe = Normalizer.normalizeToDataset([dataset]);
  const segType = multiframe.SegmentationType;
  const pixelData = BitArray.unpack(multiframe.PixelData);
  const dims = {
    x: multiframe.Columns,
    y: multiframe.Rows,
    z: imageIds.length,
    xy: multiframe.Columns * multiframe.Rows,
    xyz: multiframe.Columns * multiframe.Rows * imageIds.length
  };

  const segmentSequence = multiframe.SegmentSequence;
  const segSequence = Array.isArray(segmentSequence) ? segmentSequence : [segmentSequence]
  const segCount = segSequence.length;
  const pixelDataNDArray = ndarray(pixelData, [dims.x, dims.y, dims.z, segCount]);


  /*
    let referencePosition = referenceDataset.ImagePositionPatient;
  let rowVector = referenceDataset.ImageOrientationPatient.slice(0,3);
  let columnVector = referenceDataset.ImageOrientationPatient.slice(3,6);
  let scanAxis = ImageNormalizer.vec3CrossProduct(rowVector,columnVector);

  ds.ReferencedSeriesSequence.ReferencedInstanceSequence.push({
        ReferencedSOPClass: dataset.SOPClassUID,
        ReferencedSOPInstanceUID: dataset.SOPInstanceUID,
      });
 */

  if (segType === "FRACTIONAL") {
    const maximumFractionalValue = multiframe.MaximumFractionalValue;
    let isActuallyBinary = false;

    for (let i = 0; i < pixelData.length; i++) {
      if (pixelData[i] !== 0 && pixelData[i] !== maximumFractionalValue) {
        isActuallyBinary = true;
        break;
      }
    }

    if (!isActuallyBinary) {
      console.warn(
        "This is a fractional segmentation, which is not currently supported."
      );
      return;
    }

    console.warn(
      "This segmentation object is actually binary... processing as such."
    );
  }

  const segMetadata = {
    seriesInstanceUid: multiframe.SeriesInstanceUid,
    data: []
  };
  const numSlices = imageIds.length;

  // Add the segmentation metadata to the tool state
  for (let segIdx = 0; segIdx < segCount; segIdx++) {
    segMetadata.data.push(segmentSequence[segIdx]);
  }

  const toolState = {};

  // For each segment, on each image, slice the input array
  // to obtain the brush data.
  for (let sliceIdx = 0; sliceIdx < numSlices; sliceIdx++) {
    const imageId = imageIds[sliceIdx];
    const brushData = [];
    const imageIdSpecificToolState = {
      brush: {
        data: []
      }
    };

    for (let segIdx = 0; segIdx < segCount; segIdx++) {
      imageIdSpecificToolState.brush.data[segIdx] = {
        invalidated: true,
        pixelData: getBrushToolState(pixelData, segIdx, sliceIdx)
      };
    }

    toolState[imageId] = imageIdSpecificToolState;
  }

  return { toolState, segMetadata };
}
