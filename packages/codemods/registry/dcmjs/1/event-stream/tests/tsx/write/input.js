import dcmjs from "@dcmjs-org/dcmjs";
import { StreamingPart10Writer } from "@dcmjs-org/dcmjs/eventStream";

const { DicomDict, DicomMetaDictionary } = dcmjs.data;

export async function save(dataset, meta) {
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  const buffer = dicomDict.write({ allowInvalidVRLength: true });
  return buffer;
}

export function saveSync(dataset, meta) {
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  return dicomDict.write();
}
