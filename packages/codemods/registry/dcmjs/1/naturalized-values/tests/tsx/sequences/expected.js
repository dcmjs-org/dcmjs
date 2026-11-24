import dcmjs from "@dcmjs-org/dcmjs";

const ds = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dict);
Array.from(ds.ReferencedSeriesSequence).forEach(series => use(series));
const uids = Array.from(ds.ReferencedImageSequence).map(item => item.ReferencedSOPInstanceUID);
ds.ContentSequence.push(item);
if (Array.isArray(ds.ReferencedSeriesSequence)) {
  first = ds.ReferencedSeriesSequence[0];
}
ds.OtherSequence?.forEach(use);
for (const item of ds.ReferencedImageSequence) use(item);
