const toArray = function(x) {
  return x.constructor.name === "Array" ? x : [x];
};

const codeMeaningEquals = codeMeaningName => {
  return contentItem => {
    return contentItem.ConceptNameCodeSequence.CodeMeaning === codeMeaningName;
  };
};

/**
 * createSegFromImages - description
 *
 * @param  {Object[]} images    An array of the cornerstone image objects.
 * @param  {Boolean} isMultiframe Whether the images are multiframe.
 * @returns {Object}              The Seg derived dataSet.
 */
function createSegFromImages(images, isMultiframe) {
  const datasets = [];

  if (isMultiframe) {
    const image = images[0];
    const arrayBuffer = image.data.byteArray.buffer;

    const dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
      dicomData.dict
    );

    dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(
      dicomData.meta
    );

    datasets.push(dataset);
  } else {
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const arrayBuffer = image.data.byteArray.buffer;
      const dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
      const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        dicomData.dict
      );

      dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(
        dicomData.meta
      );
      datasets.push(dataset);
    }
  }

  const multiframe = dcmjs.normalizers.Normalizer.normalizeToDataset(datasets);

  return new dcmjs.derivations.Segmentation([multiframe]);
}

export { toArray, codeMeaningEquals, createSegFromImages };
