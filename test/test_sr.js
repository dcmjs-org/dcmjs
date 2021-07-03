const expect = require("chai").expect;
const dcmjs = require("../build/dcmjs");

const fs = require("fs");
const { http, https } = require("follow-redirects");
const os = require("os");
const path = require("path");

const { DicomMetaDictionary, DicomDict, DicomMessage } = dcmjs.data;

const IMAGING_MEASUREMENT = "126010";
const FINDING = "121071";
const FINDING_SITE_SCT = "363698007";
const FINDING_SITE_SRT = "G-C0E3";
const LONG_AXIS = "G-A185";
const SHORT_AXIS = "G-A186";
const LENGTH = "G-D7FE";

function toArray(x) {
    return Array.isArray(x) ? x : [x];
}

function downloadToFile(url, filePath) {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(filePath);
        const request = https
            .get(url, response => {
                response.pipe(fileStream);
                fileStream.on("finish", () => {
                    resolve(filePath);
                });
            })
            .on("error", reject);
    });
}


const tests = {
    test_point: () => {
        const srURL =
        "https://github.com/dcmjs-org/data/releases/download/DICOMSR_Prostate_X/ProstateX-sr.dcm";
        const srFilePath = path.join(os.tmpdir(), "ProstateX-sr.dcm");

        downloadToFile(srURL, srFilePath).then(() => {
            const arrayBuffer = fs.readFileSync(srFilePath)
                .buffer;
            const dicomDict = DicomMessage.readFile(
                arrayBuffer
            );
            const dataset = DicomMetaDictionary.naturalizeDataset(
                dicomDict.dict
            );
            expect(dataset.Modality).to.equal('SR');
            expect(dataset.ContentSequence).to.not.equal(undefined);

            const measurement = toArray(dataset.ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === IMAGING_MEASUREMENT
            );
            const finding = toArray(measurement.ContentSequence[0].ContentSequence).find(
                (group) => group.ConceptNameCodeSequence.CodeValue === FINDING
            );
            expect(finding.ConceptCodeSequence.CodeValue).to.equal("52988006");
            expect(finding.ConceptCodeSequence.CodingSchemeDesignator).to.equal("SCT");
            expect(finding.ConceptCodeSequence.CodeMeaning).to.equal("Lesion");
            
            const findingSite = toArray(measurement.ContentSequence[0].ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === FINDING_SITE_SCT
            );
            expect(findingSite.ConceptCodeSequence.CodeValue).to.equal("279706003");
            expect(findingSite.ConceptCodeSequence.CodingSchemeDesignator).to.equal("SCT");
            expect(findingSite.ConceptCodeSequence.CodeMeaning).to.equal("Peripheral zone of the prostate");
            
            const roi = toArray(
                measurement.ContentSequence[0].ContentSequence
            ).find((group) => group.ValueType === "SCOORD3D");

            expect(roi.GraphicType).to.equal("POINT");
            expect(roi.GraphicData).to.deep.equal([
                -0.7838299870491028,
                30.95800018310547,
                -29.05820083618164,
            ]);

            console.log("Finished test_point");
        });
    },
    test_bounding_box: () => {
        const srURL =
      "https://github.com/dcmjs-org/data/releases/download/DICOMSR_PetCtLung_BB/Lung_Dx-SR.dcm";
        const srFilePath = path.join(os.tmpdir(), "Lung_Dx-SR.dcm");

        downloadToFile(srURL, srFilePath).then(() => {
            const arrayBuffer = fs.readFileSync(srFilePath)
                .buffer;
            const dicomDict = DicomMessage.readFile(
                arrayBuffer
            );
            const dataset = DicomMetaDictionary.naturalizeDataset(
                dicomDict.dict
            );
            expect(dataset.Modality).to.equal('SR');
            expect(dataset.ContentSequence).to.not.equal(undefined);
            const measurement = toArray(dataset.ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === IMAGING_MEASUREMENT
            );
            const finding = toArray(measurement.ContentSequence[0].ContentSequence).find(
                (group) => group.ConceptNameCodeSequence.CodeValue === FINDING
            );
            expect(finding.ConceptCodeSequence.CodeValue).to.equal("108369006");
            expect(finding.ConceptCodeSequence.CodingSchemeDesignator).to.equal("SCT");
            expect(finding.ConceptCodeSequence.CodeMeaning).to.equal("Neoplasm");
          
            const findingSite = toArray(measurement.ContentSequence[0].ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === FINDING_SITE_SCT
            );
            expect(findingSite.ConceptCodeSequence.CodeValue).to.equal("39607008");
            expect(findingSite.ConceptCodeSequence.CodingSchemeDesignator).to.equal("SCT");
            expect(findingSite.ConceptCodeSequence.CodeMeaning).to.equal("Lung");
          
            const roi = toArray(
                measurement.ContentSequence[0].ContentSequence
            ).find((group) => group.ValueType === "SCOORD");

            expect(roi.GraphicType).to.equal("POLYLINE");
            expect(roi.GraphicData).to.deep.equal([
                134,
                198,
                165,
                198,
                165,
                233,
                134,
                233,
                134,
                198
            ]);
            console.log("Finished test_bounding_box");
        });
    },
    test_bidirectional: () => {
        const srURL =
      "https://github.com/dcmjs-org/data/releases/download/DICOMSR_CCC2018_Bidirectional/ccc2018_bidirectional_sr.dcm";
        const srFilePath = path.join(os.tmpdir(), "ccc2018_bidirectional_sr.dcm");

        downloadToFile(srURL, srFilePath).then(() => {
            const arrayBuffer = fs.readFileSync(srFilePath)
                .buffer;
            const dicomDict = DicomMessage.readFile(
                arrayBuffer
            );
            const dataset = DicomMetaDictionary.naturalizeDataset(
                dicomDict.dict
            );
            expect(dataset.Modality).to.equal('SR');
            expect(dataset.ContentSequence).to.not.equal(undefined);
            const measurement = toArray(dataset.ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === IMAGING_MEASUREMENT
            );
            const finding = toArray(measurement.ContentSequence.ContentSequence).find(
                (group) => group.ConceptNameCodeSequence.CodeValue === FINDING
            );
            expect(finding.ConceptCodeSequence.CodeValue).to.equal("RID5741");
            expect(finding.ConceptCodeSequence.CodingSchemeDesignator).to.equal("RADLEX");
            expect(finding.ConceptCodeSequence.CodeMeaning).to.equal("solid");
        
            const findingSite = toArray(measurement.ContentSequence.ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === FINDING_SITE_SRT
            );
            expect(findingSite.ConceptCodeSequence.CodeValue).to.equal("39607008");
            expect(findingSite.ConceptCodeSequence.CodingSchemeDesignator).to.equal("SRT");
            expect(findingSite.ConceptCodeSequence.CodeMeaning).to.equal("Lung structure");
        
            const longaxis = toArray(measurement.ContentSequence.ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === LONG_AXIS
            );

            expect(longaxis.MeasuredValueSequence.NumericValue).to.equal(16.1);

            const shortaxis = toArray(measurement.ContentSequence.ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === SHORT_AXIS
            );

            expect(shortaxis.MeasuredValueSequence.NumericValue).to.equal(8.1);
            
            console.log("Finished test_bidirectional");
        });
    },
    test_length: () => {
        const srURL =
    "https://github.com/dcmjs-org/data/releases/download/DICOMSR_CCC2017_Length/ccc2017_length_sr.dcm";
        const srFilePath = path.join(os.tmpdir(), "ccc2017_length_sr.dcm");

        downloadToFile(srURL, srFilePath).then(() => {
            const arrayBuffer = fs.readFileSync(srFilePath)
                .buffer;
            const dicomDict = DicomMessage.readFile(
                arrayBuffer
            );
            const dataset = DicomMetaDictionary.naturalizeDataset(
                dicomDict.dict
            );
            expect(dataset.Modality).to.equal('SR');
            expect(dataset.ContentSequence).to.not.equal(undefined);
            const measurement = toArray(dataset.ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === IMAGING_MEASUREMENT
            );
            
            const findingSite = toArray(measurement.ContentSequence.ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === FINDING_SITE_SRT
            );
            expect(findingSite.ConceptCodeSequence.CodeValue).to.equal("T-87000");
            expect(findingSite.ConceptCodeSequence.CodingSchemeDesignator).to.equal("SRT");
            expect(findingSite.ConceptCodeSequence.CodeMeaning).to.equal("Ovary");
      
            const length = toArray(measurement.ContentSequence.ContentSequence).find(
                (group) =>
                    group.ConceptNameCodeSequence.CodeValue === LENGTH
            );

            expect(length.MeasuredValueSequence.NumericValue).to.equal(51.86852852);
          
            console.log("Finished test_bidirectional");
        });
    },
}

exports.test = async testToRun => {
    Object.keys(tests).forEach(testName => {
        if (
            testToRun &&
          !testName.toLowerCase().includes(testToRun.toLowerCase())
        ) {
            console.log("-- Skipping " + testName);
            return false;
        }
        console.log("-- Starting " + testName);
        tests[testName]();
    });
};

exports.tests = tests;

