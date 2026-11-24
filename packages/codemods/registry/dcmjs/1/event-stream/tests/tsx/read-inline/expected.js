import dcmjs from "@dcmjs-org/dcmjs";
import { DicomEventStream } from "@dcmjs-org/dcmjs/eventStream";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

export async function load(buffer) {
  const dataset = await DicomEventStream.fromPart10(buffer).toNaturalized();
  return dataset;
}
