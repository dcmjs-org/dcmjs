import { StructuredReport } from '../../derivations.js';
import TID1500MeasurementReport from '../../utilities/TID1500/TID1500MeasurementReport.js';
import TID1501MeasurementGroup from '../../utilities/TID1500/TID1501MeasurementGroup.js';
import TID300Length from '../../utilities/TID300/Length.js';

// Object which maps between the Cornerstone toolType and the
// appropriate TID300 Measurement Type Class.
const TOOL_CONSTRUCTORS = {
  length: TID300Length
};

function getToolArgs(tool, toolType) {
  switch (toolType) {
    case 'length':
      const point1 = tool.handles.start;
      const point2 = tool.handles.end;
      const distance = tool.length;

      return { point1, point2, distance };
  }
}

function getTID300ContentItem(tool, toolType, ReferencedSOPSequence, ToolConstructor) {

  const args = getToolArgs(tool, toolType);
  args.ReferencedSOPSequence = ReferencedSOPSequence;

  const TID300Measurement = new ToolConstructor(args);

  return TID300Measurement;
}

function getMeasurementGroup(toolType, toolData, ReferencedSOPSequence) {
  const toolTypeData = toolData[toolType];
  const ToolConstructor = TOOL_CONSTRUCTORS[toolType];
  if (!toolTypeData || !toolTypeData.data || !toolTypeData.data.length) {
    return;
  }


  // Loop through the array of tool instances
  // for this tool
  const Measurements = toolTypeData.data.map(tool => {
    return getTID300ContentItem(tool, toolType, ReferencedSOPSequence, ToolConstructor);
  });

  return new TID1501MeasurementGroup(Measurements);
}

export default class MeasurementReport {
  constructor() {

  }

  static generateReport(toolState, metadataProvider) {
    // ToolState for array of imageIDs to a Report
    // Assume Cornerstone metadata provider has access to Study / Series / Sop Instance UID

    let allMeasurementGroups = [];
    const firstImageId = Object.keys(toolState)[0];
    const generalSeriesModule = metadataProvider.get('generalSeriesModule', firstImageId);
    const { studyInstanceUID, seriesInstanceUID } = generalSeriesModule

    // Loop through each image in the toolData
    Object.keys(toolState).forEach(imageId => {
      // TODO: Verify that all images are for same patient and study
      // TODO: Check these: study / instance are undefined...
      const generalSeriesModule = metadataProvider.get('generalSeriesModule', imageId);
      const sopCommonModule = metadataProvider.get('sopCommonModule', imageId);

      const toolData = toolState[imageId];
      const toolTypes = Object.keys(toolData);

      const ReferencedSOPSequence = {
        ReferencedSOPClassUID: sopCommonModule.sopClassUID,
        ReferencedSOPInstanceUID: sopCommonModule.sopInstanceUID,
        ReferencedFrameNumber: 0 // TOOD: Find from imageId,
      };

      // Loop through each tool type for the image
      const measurementGroups = toolTypes.map(toolType => {
        return getMeasurementGroup(toolType, toolData, ReferencedSOPSequence);
      });

      allMeasurementGroups = allMeasurementGroups.concat(measurementGroups);
    });

    const MeasurementReport = new TID1500MeasurementReport(allMeasurementGroups);

    // TODO: what is the correct metaheader
    // http://dicom.nema.org/medical/Dicom/current/output/chtml/part10/chapter_7.html
    // TODO: move meta creation to happen in derivations.js
    const fileMetaInformationVersionArray = new Uint16Array(1);
    fileMetaInformationVersionArray[0] = 1;

    const derivationSourceDataset = {
      StudyInstanceUID: studyInstanceUID,
      SeriesInstanceUID: seriesInstanceUID,
      //SOPInstanceUID: sopInstanceUID, // TODO: Necessary?
      //SOPClassUID: sopClassUID,
      _meta: {
        FileMetaInformationVersion: {
          Value: fileMetaInformationVersionArray.buffer,
          VR: "OB"
        },
        //MediaStorageSOPClassUID: dataset.SOPClassUID,
        //MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
        TransferSyntaxUID: "1.2.840.10008.1.2.1", // Explicit little endian (always for dcmjs?)
        ImplementationClassUID: dcmjs.data.DicomMetaDictionary.uid(), // TODO: could be git hash or other valid id
        ImplementationVersionName: "dcmjs"
      }
    };
    const report = new StructuredReport([derivationSourceDataset]);

    report._meta = derivationSourceDataset._meta;

    const contentItem = MeasurementReport.contentItem(derivationSourceDataset);

    // Merge the derived dataset with the content from the Measurement Report
    report.dataset = Object.assign(report.dataset, contentItem);

    return report;
  }

  // TODO: Find a way to define 'how' to get an imageId
  static generateToolState(dataset, getImageIdFunction) {
    // Ingest report, generate toolState = { imageIdx: [], imageIdy: [] }
    // Need to provide something to generate imageId from Study / Series / Sop Instance UID

    // Given a dataset
    // Verify that it's structured report
    // Checks that it is TID1500
    // extract



    // Identify the Imaging Measurements
    const imagingMeasurementContent = toArray(dataset.ContentSequence).find(codeMeaningEquals("Imaging Measurements"));

    // Retrieve the Measurements themselves
    const measurementGroupContent = toArray(imagingMeasurementContent.ContentSequence).find(codeMeaningEquals("Measurement Group"));

    // For now, bail out if the dataset is not a TID1500 SR with length measurements
    // TODO: generalize to the various kinds of report
    // TODO: generalize to the kinds of measurements the Viewer supports
    if (dataset.ContentTemplateSequence.TemplateIdentifier !== "1500") {
      OHIF.log.warn("This package can currently only interpret DICOM SR TID 1500");

      return {};
    }

    // TODO: Find all tools
    ['length', 'bidimensional'].forEach(() => {
      // Filter to find Length measurements in the Structured Report
      const lengthMeasurementContent = toArray(measurementGroupContent.ContentSequence).filter(codeMeaningEquals("Length"));

      // Retrieve Length Measurement Data
      return getLengthMeasurementData(lengthMeasurementContent, displaySets);
    });

    // combine / reorganize all the toolData into the expected toolState format for Cornerstone Tools
  }
}

