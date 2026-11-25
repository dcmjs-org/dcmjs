const dcmjs = require("@dcmjs-org/dcmjs");

async function load(buffer) {
  return dcmjs.data.DicomMetaDictionary.naturalizeDataset(dcmjs.data.DicomMessage.readFile(buffer).dict);
}
