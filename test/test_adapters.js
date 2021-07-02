const expect = require("chai").expect;
const dcmjs = require("../build/dcmjs");
const { MeasurementReport } = dcmjs.adapters.Cornerstone;

const bidirectionalToolstate = {
    "1.3.6.1.4.1.14519.5.2.1.4334.1501.204038471157187984095376885814&frame=1": {
        Bidirectional: {
            data: [
                {
                    toolType: "Bidirectional",
                    isCreating: false,
                    visible: true,
                    active: false,
                    invalidated: true,
                    handles: {
                        start: {
                            x: 358.3673400878906,
                            y: 204.6700439453125,
                            index: 0,
                            drawnIndependently: false,
                            allowedOutsideImage: false,
                            highlight: true,
                            active: false,
                        },
                        end: {
                            x: 358.6566162109375,
                            y: 182.97471618652344,
                            index: 1,
                            drawnIndependently: false,
                            allowedOutsideImage: false,
                            highlight: true,
                            active: false,
                        },
                        perpendicularStart: {
                            x: 363.9358215332031,
                            y: 193.8946990966797,
                            index: 2,
                            drawnIndependently: false,
                            allowedOutsideImage: false,
                            highlight: true,
                            active: false,
                            locked: false,
                        },
                        perpendicularEnd: {
                            x: 353.088134765625,
                            y: 193.75006103515625,
                            index: 3,
                            drawnIndependently: false,
                            allowedOutsideImage: false,
                            highlight: true,
                            active: false,
                        },
                        textBox: {
                            x: 358.3673400878906,
                            y: 204.6700439453125,
                            index: null,
                            drawnIndependently: true,
                            allowedOutsideImage: true,
                            highlight: false,
                            active: false,
                            hasMoved: false,
                            movesIndependently: false,
                            hasBoundingBox: true,
                        },
                    },
                    aimId: "2.25.746948110250556618597051441934648086314",
                    longestDiameter: 16.1,
                    unit: "mm",
                    shortestDiameter: 8.1,
                    trackingIdentifier: "web annotation",
                    trackingUniqueIdentifier:
            "2.25.797388882284565263543728324912886045063",
                    finding: {
                        CodeValue: "ROI",
                        CodingSchemeDesignator: "99EPAD",
                        CodeMeaning: "ROI Only",
                    },
                    findingSites: [],
                    comment: "undefined / undefined / undefined / undefined",
                },
            ],
        },
    },
};
const imageIds =[
    '1.3.6.1.4.1.14519.5.2.1.4334.1501.204038471157187984095376885814&frame=1'
];

const bidirectionalMetaDataProvider = {
    get(type, imageId) {
        if (type === "generalSeriesModule") {
            if (imageIds.includes(imageId)) {
                return {
                    studyInstanceUID: '1.3.6.1.4.1.14519.5.2.1.4334.1501.772823147212833057678103865443',
                    seriesInstanceUID: '1.3.6.1.4.1.14519.5.2.1.4334.1501.128241934543986080196677451907',
                };
            }
        }
        if (type === "sopCommonModule") {
            if (imageIds.includes(imageId)) {
                return {
                    sopInstanceUID: imageId.split("&frame=")[0],
                    sopClassUID: '1.2.840.10008.5.1.4.1.1.2'
                };
            }
        }
        if (type === "frameNumber") {
            if (imageIds.includes(imageId)) {
                return imageId.split("&frame=")[1]
                    ? imageId.split("&frame=")[1]
                    : 1;
            }
        }
        if (type === "patientModule") {
            if (imageIds.includes(imageId)) {
                return {
                    patientID: 'AMC-001',
                    patientName : '',
                    patientBirthDate: '',
                    patientSex: '',
                };
            }
        }
        return null;
    },
};

const IMAGING_MEASUREMENT = "126010";
const LONG_AXIS = "103339001";
const SHORT_AXIS = "103340004";

function toArray(x) {
    return Array.isArray(x) ? x : [x];
}

const tests = {
    test_bidirectional_adapter: () => {
        const report = MeasurementReport.generateReport(
            bidirectionalToolstate,
            bidirectionalMetaDataProvider,
            {}
        );
        expect(report.dataset.Modality).to.equal("SR");
        expect(report.dataset.ContentSequence).to.not.equal(undefined);
        
        const measurement = toArray(report.dataset.ContentSequence).find(
            (group) => group.ConceptNameCodeSequence.CodeValue === IMAGING_MEASUREMENT
        );
        const longaxis = toArray(measurement.ContentSequence[0].ContentSequence).find(
            (group) => group.ConceptNameCodeSequence.CodeValue === LONG_AXIS
        );
        expect(longaxis.MeasuredValueSequence.NumericValue).to.equal(16.1);

        const shortaxis = toArray(measurement.ContentSequence[0].ContentSequence).find(
            (group) => group.ConceptNameCodeSequence.CodeValue === SHORT_AXIS
        );
        expect(shortaxis.MeasuredValueSequence.NumericValue).to.equal(8.1);

        console.log("Finished test_bidirectional_adapter");
    },
};

exports.test = async (testToRun) => {
    Object.keys(tests).forEach((testName) => {
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
