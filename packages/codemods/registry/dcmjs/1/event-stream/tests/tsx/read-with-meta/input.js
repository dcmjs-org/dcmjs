import dcmjs from "@dcmjs-org/dcmjs";

export const load = async (buffer) => {
  const dicomDict = dcmjs.data.DicomMessage.readFile(buffer, { ignoreErrors: true });
  const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
  const meta = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.meta);
  return { dataset, meta, frame: dataset.PixelData[0] };
};
