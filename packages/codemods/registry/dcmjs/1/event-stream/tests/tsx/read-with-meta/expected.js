import dcmjs from "@dcmjs-org/dcmjs";
import { DicomEventStream, NaturalizedListener } from "@dcmjs-org/dcmjs/eventStream";

export const load = async (buffer) => {
  const dicomDict = await DicomEventStream.fromPart10(buffer, { ignoreErrors: true }).process(new NaturalizedListener());
  const dataset = dicomDict.result;
  const meta = dicomDict.meta;
  return { dataset, meta, frame: dataset.PixelData[0] };
};
