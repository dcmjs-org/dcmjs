import dcmjs from "@dcmjs-org/dcmjs";

const { DicomMetaDictionary, ValueRepresentation } = dcmjs.data;
const ds = DicomMetaDictionary.naturalizeDataset(dict);

DicomMetaDictionary.nameMap[keyword] = entry;
ds["00290010"] = "ACME";
ds["00291001"] = "a value";
const privateKeys = Object.keys(ds).filter(key => /^[0-9A-F]{8}$/.test(key));
for (const key of Object.keys(ds._vrMap)) count++;
for (const key in ds._vrMap) count++;
const dict2 = DicomMetaDictionary.denaturalizeDataset(ds);
