import { Normalizer } from '../../normalizers.js';
import { DicomMetaDictionary } from '../../DicomMetaDictionary.js';
import { StructuredReport } from '../../derivations.js';
import TID1500MeasurementReport from '../../utilities/TID1500/TID1500MeasurementReport.js';
import TID1501MeasurementGroup from '../../utilities/TID1500/TID1501MeasurementGroup.js';

import { toArray, codeMeaningEquals } from '../helpers.js';

function getTID300ContentItem(tool, graphicType, ReferencedSOPSequence, toolClass) {
  const args = toolClass.getTID300RepresentationArguments(tool);
  args.ReferencedSOPSequence = ReferencedSOPSequence;

  return new toolClass.TID300Representation(args);
}

function getMeasurementGroup(graphicType, measurements, ReferencedSOPSequence) {
  const toolClass = MeasurementReport.MICROSCOPY_TOOL_CLASSES_BY_TOOL_TYPE[graphicType];

  // Loop through the array of tool instances
  // for this tool
  const Measurements = measurements.map(tool => {
    return getTID300ContentItem(tool, graphicType, ReferencedSOPSequence, toolClass);
  });

  return new TID1501MeasurementGroup(Measurements);
}

export default class MeasurementReport {
  constructor() {
  }

  static generateReport(rois, metadataProvider, options) {
    // Input is all ROIS returned via
    // viewer.getALLROIs()


    // Sort and split into arrays by scoord.graphicType
    const measurementsByGraphicType = {};
    rois.forEach(roi => {
      const graphicType = roi.scoord.graphicType;

      if (!measurementsByGraphicType[graphicType]) {
        measurementsByGraphicType[graphicType] = [];
      }

      measurementsByGraphicType[graphicType].push(roi.scoord);
    });

    // For each measurement, get the utility arguments using the adapter, and create TID300 Measurement
    // Group these TID300 Measurements into a TID1501 Measurement Group (for each graphicType)
    // Use TID1500MeasurementReport utility to create a single report from the created groups
    // return report;

    // TODO: Find a way to get this from the measurement itself
    const ReferencedSOPSequence = {
      ReferencedSOPClassUID: '1.32.4.4',
      ReferencedSOPInstanceUID: '1.32.4.21234'
    };

    let allMeasurementGroups = []
    const measurementGroups = [];
    Object.keys(measurementsByGraphicType).forEach(graphicType => {
      const measurements = measurementsByGraphicType[graphicType];

      const group = getMeasurementGroup(graphicType, measurements, ReferencedSOPSequence);
      if (group) {
        measurementGroups.push(group);  
      }

      allMeasurementGroups = allMeasurementGroups.concat(measurementGroups);
    });

    const MeasurementReport = new TID1500MeasurementReport(allMeasurementGroups, options);

    // TODO: what is the correct metaheader
    // http://dicom.nema.org/medical/Dicom/current/output/chtml/part10/chapter_7.html
    // TODO: move meta creation to happen in derivations.js
    const fileMetaInformationVersionArray = new Uint8Array(2);
    fileMetaInformationVersionArray[1] = 1;

    // TODO: Find out how to reference the data from dicom-microscopy-viewer
    const studyInstanceUID = '12.4';
    const seriesInstanceUID = '12.4';

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

    Object.keys(MeasurementReport.MICROSCOPY_TOOL_CLASSES_BY_UTILITY_TYPE).forEach(measurementType => {
      // Filter to find supported measurement types in the Structured Report
      const measurementGroups = toArray(measurementGroupContent.ContentSequence);
      const measurementContent = measurementGroups.filter(codeMeaningEquals(measurementType));
      if (!measurementContent) {
        return;
      }

      const toolClass = MeasurementReport.MICROSCOPY_TOOL_CLASSES_BY_UTILITY_TYPE[measurementType];
      const toolType = toolClass.toolType;

      if (!toolClass.getMeasurementData) {
        throw new Error('MICROSCOPY Tool Adapters must define a getMeasurementData static method.');
      }

      // Retrieve Length Measurement Data
      measurementData[toolType] = toolClass.getMeasurementData(measurementContent);
    });

    // TODO: Find a way to define 'how' to get an imageId ?
    // Need to provide something to generate imageId from Study / Series / Sop Instance UID
    // combine / reorganize all the toolData into the expected toolState format for MICROSCOPY Tools
    return measurementData;
  }

  static registerTool(toolClass) {
    MeasurementReport.MICROSCOPY_TOOL_CLASSES_BY_UTILITY_TYPE[toolClass.utilityToolType] = toolClass;
    MeasurementReport.MICROSCOPY_TOOL_CLASSES_BY_TOOL_TYPE[toolClass.graphicType] = toolClass;
    MeasurementReport.MEASUREMENT_BY_TOOLTYPE[toolClass.graphicType] = toolClass.utilityToolType;
  }
}

MeasurementReport.MEASUREMENT_BY_TOOLTYPE = {};
MeasurementReport.MICROSCOPY_TOOL_CLASSES_BY_UTILITY_TYPE = {};
MeasurementReport.MICROSCOPY_TOOL_CLASSES_BY_TOOL_TYPE = {}
