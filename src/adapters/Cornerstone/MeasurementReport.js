import { Normalizer } from '../../normalizers.js';
import { DicomMetaDictionary } from '../../DicomMetaDictionary.js';
import { StructuredReport } from '../../derivations.js';
import TID1500MeasurementReport from '../../utilities/TID1500/TID1500MeasurementReport.js';
import TID1501MeasurementGroup from '../../utilities/TID1500/TID1501MeasurementGroup.js';

import { toArray, codeMeaningEquals } from '../helpers.js';

function getTID300ContentItem(tool, toolType, ReferencedSOPSequence, toolClass) {
  const args = toolClass.getTID300RepresentationArguments(tool);
  args.ReferencedSOPSequence = ReferencedSOPSequence;

  const TID300Measurement = new toolClass.TID300Representation(args);

  return TID300Measurement;
}

function getMeasurementGroup(toolType, toolData, ReferencedSOPSequence) {
  const toolTypeData = toolData[toolType];
  const toolClass = MeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE[toolType];
  if (!toolTypeData || !toolTypeData.data || !toolTypeData.data.length) {
    return;
  }

  // Loop through the array of tool instances
  // for this tool
  const Measurements = toolTypeData.data.map(tool => {
    return getTID300ContentItem(tool, toolType, ReferencedSOPSequence, toolClass);
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
    if (!firstImageId) {
      throw new Error('No measurements provided.');
    }
    
    /* Patient ID
    Warning - Missing attribute or value that would be needed to build DICOMDIR - Patient ID
    Warning - Missing attribute or value that would be needed to build DICOMDIR - Study Date
    Warning - Missing attribute or value that would be needed to build DICOMDIR - Study Time
    Warning - Missing attribute or value that would be needed to build DICOMDIR - Study ID */
    const generalSeriesModule = metadataProvider.get('generalSeriesModule', firstImageId);
    const sopCommonModule = metadataProvider.get('sopCommonModule', firstImageId);
    const { studyInstanceUID, seriesInstanceUID } = generalSeriesModule

    // Loop through each image in the toolData
    Object.keys(toolState).forEach(imageId => {
      const generalSeriesModule = metadataProvider.get('generalSeriesModule', imageId);
      const sopCommonModule = metadataProvider.get('sopCommonModule', imageId);
      const frameNumber = metadataProvider.get('frameNumber', imageId);
      const toolData = toolState[imageId];
      const toolTypes = Object.keys(toolData);

      const ReferencedSOPSequence = {
        ReferencedSOPClassUID: sopCommonModule.sopClassUID,
        ReferencedSOPInstanceUID: sopCommonModule.sopInstanceUID
      };

      if (Normalizer.isMultiframeSOPClassUID(sopCommonModule.sopClassUID)) {
        ReferencedSOPSequence.ReferencedFrameNumber = frameNumber;
      }

      // Loop through each tool type for the image
      const measurementGroups = [];

      toolTypes.forEach(toolType => {
        const group = getMeasurementGroup(toolType, toolData, ReferencedSOPSequence);
        if (group) {
          measurementGroups.push(group);  
        }
      });

      allMeasurementGroups = allMeasurementGroups.concat(measurementGroups);
    });

    const MeasurementReport = new TID1500MeasurementReport(allMeasurementGroups, options);

    // TODO: what is the correct metaheader
    // http://dicom.nema.org/medical/Dicom/current/output/chtml/part10/chapter_7.html
    // TODO: move meta creation to happen in derivations.js
    const fileMetaInformationVersionArray = new Uint8Array(2);
    fileMetaInformationVersionArray[1] = 1;

    const derivationSourceDataset = {
      StudyInstanceUID: studyInstanceUID,
      SeriesInstanceUID: seriesInstanceUID,
      //SOPInstanceUID: sopInstanceUID, // TODO: Necessary?
      //SOPClassUID: sopClassUID,
    };

    const _meta = {
      FileMetaInformationVersion: {
        Value: [fileMetaInformationVersionArray.buffer],
        vr: 'OB'
      },
      //MediaStorageSOPClassUID
      //MediaStorageSOPInstanceUID: sopCommonModule.sopInstanceUID,
      TransferSyntaxUID: {
        Value: ["1.2.840.10008.1.2.1"],
        vr: 'UI'
      },
      ImplementationClassUID: {
        Value: [DicomMetaDictionary.uid()], // TODO: could be git hash or other valid id
        vr: 'UI'
      },
      ImplementationVersionName: {
        Value: ["dcmjs"],
        vr: 'SH'
      }
    };

    const _vrMap = {
      PixelData: "OW"
    };

    derivationSourceDataset._meta = _meta;
    derivationSourceDataset._vrMap = _vrMap;

    const report = new StructuredReport([derivationSourceDataset]);
    const contentItem = MeasurementReport.contentItem(derivationSourceDataset);

    // Merge the derived dataset with the content from the Measurement Report
    report.dataset = Object.assign(report.dataset, contentItem);
    report.dataset._meta = _meta;

    return report;
  }


  static generateToolState(dataset) {
    // For now, bail out if the dataset is not a TID1500 SR with length measurements
    if (dataset.ContentTemplateSequence.TemplateIdentifier !== "1500") {
      throw new Error("This package can currently only interpret DICOM SR TID 1500");
    }

    const REPORT = "Imaging Measurements";
    const GROUP = "Measurement Group";

    // Identify the Imaging Measurements
    const imagingMeasurementContent = toArray(dataset.ContentSequence).find(codeMeaningEquals(REPORT));

    // Retrieve the Measurements themselves
    const measurementGroupContent = toArray(imagingMeasurementContent.ContentSequence).find(codeMeaningEquals(GROUP));

    // For each of the supported measurement types, compute the measurement data
    const measurementData = {};

    Object.keys(MeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_UTILITY_TYPE).forEach(measurementType => {
      // Filter to find supported measurement types in the Structured Report
      const measurementGroups = toArray(measurementGroupContent.ContentSequence);
      const measurementContent = measurementGroups.filter(codeMeaningEquals(measurementType));
      if (!measurementContent) {
        return;
      }

      const toolClass = MeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_UTILITY_TYPE[measurementType];
      const toolType = toolClass.toolType;

      if (!toolClass.getMeasurementData) {
        throw new Error('Cornerstone Tool Adapters must define a getMeasurementData static method.');
      }

      // Retrieve Length Measurement Data
      measurementData[toolType] = toolClass.getMeasurementData(measurementContent);
    });

    // TODO: Find a way to define 'how' to get an imageId ?
    // Need to provide something to generate imageId from Study / Series / Sop Instance UID
    // combine / reorganize all the toolData into the expected toolState format for Cornerstone Tools
    return measurementData;
  }

  static registerTool(toolClass) {
    MeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_UTILITY_TYPE[toolClass.utilityToolType] = toolClass;
    MeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE[toolClass.toolType] = toolClass;
    MeasurementReport.MEASUREMENT_BY_TOOLTYPE[toolClass.toolType] = toolClass.utilityToolType;
  }
}

MeasurementReport.MEASUREMENT_BY_TOOLTYPE = {};
MeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_UTILITY_TYPE = {};
MeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE = {}
