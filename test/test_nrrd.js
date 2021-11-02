const expect = require("chai").expect;
const dcmjs = require("../build/dcmjs");

const nrrd_file = require('../src/nrrd/decoded_nrrd_file.json')

exports.test = () => {

  const { data, direction, imageType, name, origin, size, spacing } = nrrd_file
  const dataValues = Object.values(data)

  const jsonDataset = `{
        "PatientID": "0000000",
        "PatientName": "Zzzzzz^Yyyyy^^^",
        "SOPClassUID": "0.0.000.00000.0.0.0.0.0.0",
        "SOPInstanceUID": "0.00.000.0.000000.0.0000000000.0000000000.0000000000000000000",
        "SeriesInstanceUID": "0.00.000.0.000000.0.0000000000.0000000000.0000000000000000000",
        "StudyInstanceUID": "0.00.000.0.000000.0.0000000000.0000000000.0000000000000000000",
        "_meta": {
          "TransferSyntaxUID": {
            "Value": [
              "1.2.840.10008.1.2.1"
            ],
            "vr": "UI"
          }
        },
        "PixelRepresentation": 1,
        "Rows": ${direction.rows},
        "Columns": ${direction.columns},
        "PixelSpacing": ["${spacing[0]}", "${spacing[1]}"],
        "PixelData": [${dataValues}]
      }`;

  const dataset = JSON.parse(jsonDataset);
  const dicomDict = dcmjs.data.datasetToDict(dataset);
  const buffer = Buffer.from(dicomDict.write());
  expect(typeof buffer).to.equal('object')
}


