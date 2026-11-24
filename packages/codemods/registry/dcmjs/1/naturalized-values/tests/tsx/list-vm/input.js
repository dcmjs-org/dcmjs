import { data } from "@dcmjs-org/dcmjs";

const ds = data.DicomMetaDictionary.naturalizeDataset(dict);
const center = Number(ds.WindowCenter);
const width = ds.WindowWidth * 2;
const label = `type ${ds.ImageType}`;
const original = ds.ImageType === "ORIGINAL";
const parts = ds.ImageType.split("\\");
const list = ds.ImageType.includes("ORIGINAL");
const spacing = Number(ds.PixelSpacing[0]);
