const dcmjs = require('../build/dcmjs');

const fs = require('fs');

const program = require('commander');

program
  .command('dump <fileName>')
    .option('-o, --output [outputFileName]', 'save json file (default stdout)')
    .action( (fileName, cmd) => {

      // read the file and convert to a javascript object called dataset
      const arrayBuffer = fs.readFileSync(fileName).buffer;
      const dicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);
      const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);

      // convert the dataset to json and send to file or stdout
      const json = JSON.stringify(dataset);
      if (cmd.output) {
        fs.writeFileSync(cmd.output, json); 
      } else {
        process.stdout.write(json);
      }
      process.exit(0);
    });

program
  .command('undump <fileName>')
    .option('-o, --output [outputFileName]', 'save dicom file (default stdout)')
    .action( (fileName, cmd) => {

      // read the file and convert from json to a dataset buffer (part10)
      const json = fs.readFileSync(fileName).toString();
      const dataset = JSON.parse(json);
      const dicomDict = dcmjs.data.datasetToDict(dataset);
      const buffer = new Buffer(dicomDict.write());

      // write buffer to file or stdout
      if (cmd.output) {
        fs.writeFileSync(cmd.output, buffer); 
      } else {
        process.stdout.write(buffer);
      }

      process.exit(0);
    });

program.parse(process.argv);

console.log("No command specified.  Use -h for options.");
process.exit(1);
