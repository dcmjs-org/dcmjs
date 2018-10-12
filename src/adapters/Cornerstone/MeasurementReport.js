import { StructuredReport } from '../../derivations.js';
import TID1500MeasurementReport from '../../utilities/TID1500/TID1500MeasurementReport.js';
import TID1501MeasurementGroup from '../../utilities/TID1500/TID1501MeasurementGroup.js';
import TID300Length from '../../utilities/TID300/Length.js';
import CornerstoneLength from './Length.js';

import { toArray, codeMeaningEquals } from '../helpers.js';

// Object which maps between the Cornerstone toolType and the
// appropriate TID300 Measurement Type.
const MEASUREMENT_BY_TOOLTYPE = {
  length: 'Length'
};

// Object which maps between the Measurement Type and the
// appropriate TID300 Measurement Type Class
const TOOL_CLASSES = {
  Length: TID300Length
};

// Object which maps between the Measurement Type and the
// appropriate TID300 Measurement Type Class
const CORNERSTONE_TOOL_CLASSES = {
  Length: CornerstoneLength
};

const CORNERSTONE_TOOLTYPES = {
  Length: 'length'
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
  const measurementType = MEASUREMENT_BY_TOOLTYPE[toolType]
  const ToolClass = TOOL_CLASSES[measurementType];
  if (!toolTypeData || !toolTypeData.data || !toolTypeData.data.length) {
    return;
  }


  // Loop through the array of tool instances
  // for this tool
  const Measurements = toolTypeData.data.map(tool => {
    return getTID300ContentItem(tool, toolType, ReferencedSOPSequence, ToolClass);
  });

  return new TID1501MeasurementGroup(Measurements);
}

export default class MeasurementReport {
  constructor() {
  }

  static generateReport(toolState, metadataProvider, options) {
    // ToolState for array of imageIDs to a Report
    // Assume Cornerstone metadata provider has access to Study / Series / Sop Instance UID

    let allMeasurementGroups = [];
    const firstImageId = Object.keys(toolState)[0];
    const generalSeriesModule = metadataProvider.get('generalSeriesModule', firstImageId);
    const { studyInstanceUID, seriesInstanceUID } = generalSeriesModule

    // Loop through each image in the toolData
    Object.keys(toolState).forEach(imageId => {
      const generalSeriesModule = metadataProvider.get('generalSeriesModule', imageId);
      const sopCommonModule = metadataProvider.get('sopCommonModule', imageId);
      const toolData = toolState[imageId];
      const toolTypes = Object.keys(toolData);

      const ReferencedSOPSequence = {
        ReferencedSOPClassUID: sopCommonModule.sopClassUID,
        ReferencedSOPInstanceUID: sopCommonModule.sopInstanceUID,
        ReferencedFrameNumber: 0 // TODO: Find from imageId,
      };
      // TODO: something is wrong with my referenced sop sequence

      // Loop through each tool type for the image
      const measurementGroups = toolTypes.map(toolType => {
        return getMeasurementGroup(toolType, toolData, ReferencedSOPSequence);
      });

      allMeasurementGroups = allMeasurementGroups.concat(measurementGroups);
    });

    const MeasurementReport = new TID1500MeasurementReport(allMeasurementGroups, options);

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

    //

    const contentItem = MeasurementReport.contentItem(derivationSourceDataset);

    // Merge the derived dataset with the content from the Measurement Report
    report.dataset = Object.assign(report.dataset, contentItem);

    return report;
  }


  static generateToolState(dataset) {
    // For now, bail out if the dataset is not a TID1500 SR with length measurements
    if (dataset.ContentTemplateSequence.TemplateIdentifier !== "1500") {
      throw new Error("This package can currently only interpret DICOM SR TID 1500");
    }

    const REPORT = "Imaging Measurements";
    const GROUP = "Measurement Group";
    const SUPPORTED_MEASUREMENTS = [
      "Length"
    ];

    // Identify the Imaging Measurements
    const imagingMeasurementContent = toArray(dataset.ContentSequence).find(codeMeaningEquals(REPORT));

    // Retrieve the Measurements themselves
    const measurementGroupContent = toArray(imagingMeasurementContent.ContentSequence).find(codeMeaningEquals(GROUP));

    // For each of the supported measurement types, compute the measurement data
    const measurementData = {};

    SUPPORTED_MEASUREMENTS.forEach(measurementType => {
      // Filter to find supported measurement types in the Structured Report
      const measurementGroups = toArray(measurementGroupContent.ContentSequence);
      const measurementContent = measurementGroups.filter(codeMeaningEquals(measurementType));
      if (!measurementContent) {
        return;
      }

      const ToolClass = CORNERSTONE_TOOL_CLASSES[measurementType];
      const toolType = CORNERSTONE_TOOLTYPES[measurementType];

      if (!ToolClass.getMeasurementData) {
        throw new Error('Cornerstone Tool Adapters must define a getMeasurementData static method.');
      }

      // Retrieve Length Measurement Data
      measurementData[toolType] = ToolClass.getMeasurementData(measurementContent);
    });

    // TODO: Find a way to define 'how' to get an imageId ?
    // Need to provide something to generate imageId from Study / Series / Sop Instance UID
    // combine / reorganize all the toolData into the expected toolState format for Cornerstone Tools

    return measurementData;
  }
}

