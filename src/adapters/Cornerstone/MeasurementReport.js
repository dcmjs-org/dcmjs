// ToolState for array of imageIDs to a Report
// Assume Cornerstone metadata provider has access to Study / Series / Sop Instance UID
// (by default, look with cornerstone.metadata.get())

// Ingest report, generate toolState = { imageIdx: [], imageIdy: [] }
// Need to provide something to generate imageId from Study / Series / Sop Instance UID

// Length tool to SR
// SR to Length tool

class MeasurementReport() {
  constructor() {

  }

  static generateTID1500MeasurementReport(toolData, metadataProvider) {
    // check we have access to cornerstone.metadata?

    // fill it in with all the Cornerstone data

    // for images
      // TODO: Verify that all images are for same patient and study

      // for tooltype
        // for tool instance
          // generate TID300Measurement ContentItem
      // generate TID1501MeasurementGroup ContentItem from TID300Measurements
    // generate TID1500MeasurementReport from TID1501MeasurementGroups

    // get datasets from images (or use the first image)
    // TODO: figure out what is needed to make a dcmjs dataset from
    // information available in the viewer.  Apparently the raw dicom is not available
    // directly.

    // TODO: what is the correct metaheader
    // http://dicom.nema.org/medical/Dicom/current/output/chtml/part10/chapter_7.html
    // TODO: move meta creation to dcmjs
    const fileMetaInformationVersionArray = new Uint16Array(1);
    fileMetaInformationVersionArray[0] = 1;

    const derivationSourceDataset = {
      StudyInstanceUID: studyInstanceUid,
      SeriesInstanceUID: seriesInstanceUid,
      SOPInstanceUID: sopInstanceUid,
      SOPClassUID: sopClassUid,
      _meta: {
        FileMetaInformationVersion: fileMetaInformationVersionArray.buffer,
        MediaStorageSOPClassUID: dataset.SOPClassUID,
        MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
        TransferSyntaxUID: "1.2.840.10008.1.2.1", // Explicit little endian (always for dcmjs?)
        ImplementationClassUID: dcmjs.data.DicomMetaDictionary.uid(), // TODO: could be git hash or other valid id
        ImplementationVersionName: "OHIFViewer"
      }
    };
    const report = new StructuredReport([derivationSourceDataset]);

    // place TID1500MeasurementReport content item into Dataset
    // return dataset;
    const report = new TID1500MeasurementReport();
  }

  // TODO: Find a way to define 'how' to get an imageId
  static generateToolState(dataset, getImageIdFunction) {
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

