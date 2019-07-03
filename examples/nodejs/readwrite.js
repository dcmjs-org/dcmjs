const dcmjs = require("../../build/dcmjs");
const fs = require("fs");

// TODO: fetch this from S3 or somewhere.  For now, users replace with their test file
const filePath = "/Users/pieper/data/public-dicom/MRHead-multiframe+seg/MRHead-multiframe.dcm"

let arrayBuffer = fs.readFileSync(filePath).buffer;

let DicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);

const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(DicomDict.dict);

dataset.PatientName = "Name^Somebody's^^^"

DicomDict.dict = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(dataset);

let new_file_WriterBuffer = DicomDict.write();

fs.writeFileSync("/tmp/file.dcm", Buffer.from(new_file_WriterBuffer)); 
