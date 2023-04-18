import fs from 'fs';
import path from 'path';
import dcmjs from "../../src/index.js";

const { DicomMessage } = dcmjs.data;

describe('test parsing of sample-dicom.dcm file', () => {
    const dicomTestFilesDataPath = path.join(__dirname, './../sample-dicom.dcm');

    const arrayBuffer = fs.readFileSync(dicomTestFilesDataPath).buffer;
    const dicomDict = DicomMessage.readFile(arrayBuffer);

    it('has dict and meta section', () => {
        expect(dicomDict['dict']).not.toBeNull();
        expect(dicomDict['meta']).not.toBeNull();
    })

    describe('test some tags from the dict section', () => {
        const dictTags = dicomDict['dict'];

        it('has the StudyDate', () => {
            expect(dictTags).toHaveProperty('00080020.Value[0]', '20010101');
        })
        // testing nested sequence parsing
        it('has the  RequestAttributesSequence -> ScheduledProtocolCodeSequence -> CodeValue', () => {
            expect(dictTags).toHaveProperty('00400275.Value[0].00400008.Value[0].00080100.Value[0]', '6310');
        })

    })

    describe('test some tags from the meta section', () => {
        const metaTags = dicomDict['meta'];

        it('has the TransferSyntaxUID', () => {
            expect(metaTags).toHaveProperty('00020010.Value[0]', '1.2.840.10008.1.2');
        })

    })
})