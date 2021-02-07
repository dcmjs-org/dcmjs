const fs = require('fs');
const path = require('path');
const dcmjs = require('../build/dcmjs');
const {
    data: { DicomMessage },
} = dcmjs;

const inputPath = process.argv[2] || './input/1.3.6.1.4.1.5962.99.1.2280943358.716200484.1363785608958.69.0.dcm';
const outputDir = process.argv[3] || path.resolve(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

async function iterate(inputPath) {
    let buffer = fs.readFileSync(inputPath).buffer;
    let json;
    const start = Date.now();

    for (let i = 0; i < 100; ++i) {
        usage('before dcmjs load', i);
        json = DicomMessage.readFile(buffer);
        await usage('before dcmjs write', i);
        buffer = json.write();
        usage('after dcmjs write', i);
        const outputPath = path.resolve(outputDir, `output-${i}.dcm`);
        usage('before write file', i);
        fs.writeFileSync(outputPath, new Uint8Array(buffer));
        usage('after write file', i);
    }

    console.log(`Finished. Total Time elapsed: ${Date.now() - start} ms`)
}

async function usage(title, i) {
    console.log(`---------- [${i}] ${title} ----------`)
    const dict = process.memoryUsage();
    Object.keys(dict).forEach(key => {
        const used = dict[key] / 1024 / 1024;
        console.log(`${key}: ${Math.round(used * 100) / 100} MB`);
    });
}

iterate(inputPath);
