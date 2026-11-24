import dcmjs from "@dcmjs-org/dcmjs";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

export async function load(buffer) {
  const dataset = DicomMetaDictionary.naturalizeDataset(DicomMessage.readFile(buffer).dict);
  return dataset;
}
