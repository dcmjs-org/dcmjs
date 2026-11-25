import { data } from "@dcmjs-org/dcmjs";

export function loadSync(buffer) {
  const dicomDict = data.DicomMessage.readFile(buffer);
  const dataset = data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
  return dataset;
}

export async function loadHeader(buffer) {
  const dicomDict = data.DicomMessage.readFile(buffer, { untilTag: "7FE00010" });
  const dataset = data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
  return dataset;
}

export async function loadTwice(buffer) {
  const dicomDict = data.DicomMessage.readFile(buffer);
  const dataset = data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
  return { dataset, raw: dicomDict.dict };
}

export function readOnly(buffer) {
  return data.DicomMessage.readFile(buffer).dict["00100010"];
}
