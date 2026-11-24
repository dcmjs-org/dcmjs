import dcmjs from "@dcmjs-org/dcmjs";
import { StreamingPart10Writer, DicomEventStream } from "@dcmjs-org/dcmjs/eventStream";

const { DicomDict, DicomMetaDictionary } = dcmjs.data;

export async function save(dataset, meta) {
  dataset._meta = meta;
  const buffer = await DicomEventStream.fromNaturalized(dataset).toPart10({ allowInvalidVRLength: true });
  return buffer;
}

export function saveSync(dataset, meta) {
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  return dicomDict.write();
}
