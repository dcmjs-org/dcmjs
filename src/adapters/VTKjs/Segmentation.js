const Segmentation = {
  createSEG,
  generateImageData
};

export default Segmentation;

/**
 * createSEG - creates a DICOM SEG using vtkjs labelmap data.
 *
 * @param  {Uint8ClampedArray} labelMap An array of voxel labels.
 * @param  {object[]} images   An array of the images.
 * @param  {object[]} segments An array of the segment metadata.
 * @returns {ArrayBuffer}      The DICOM SEG.
 */
function createSEG(labelMap, images, segments) {
  const dims = {
    x: image0.columns,
    y: image0.rows,
    z: images.length
  };

  dims.xy = dims.x * dims.y;
  dims.xyz = dims.xy * dims.z;
}

function generateImageData() {}
