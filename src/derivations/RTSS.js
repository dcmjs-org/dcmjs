import DerivedDataset from "./DerivedDataset";
import { DicomMetaDictionary } from "../DicomMetaDictionary";

export default class RTSS extends DerivedDataset {
    constructor(datasets, options = {}) {
        super(datasets, options);
    }

    // this assumes a normalized multiframe input and will create
    // a multiframe derived image
    derive() {
        super.derive();

        this.assignToDataset({
            SOPClassUID:
                DicomMetaDictionary.sopClassUIDsByName.RTStructureSetStorage,
            Modality: "RTSTRUCT",
            ValueType: "CONTAINER"
        });

        this.assignFromReference([]);

        this.dataset.ReferencedFrameOfReferenceSequence = [];
        this.dataset.StructureSetROISequence = [];
        this.dataset.ROIContourSequence = [];
        this.dataset.RTROIObservationsSequence = [];
        //console.log(this.referencedDataset);

        // NOTE: was previously under addContour
        const dataset = this.dataset;

        // Populate ReferencedFrameOfReferenceSequence
        // Referenced DICOM data
        const ReferencedFrameOfReferenceSequence =
            dataset.ReferencedFrameOfReferenceSequence;

        //const FrameOfReferenceUID =
        const FrameOfReferenceUID = this.referencedDataset.FrameOfReferenceUID;

        // DICOM set that is referenced
        const ContourImageSequence = [];
        this.referencedDataset.ReferencedSeriesSequence.ReferencedInstanceSequence.forEach(
            instance => {
                ContourImageSequence.push(instance);
            }
        );

        const RTReferencedSeriesSequence = [];
        const RTReferencedSeries = {
            SeriesInstaceUID: this.referencedDataset.ReferencedSeriesSequence
                .SeriesInstanceUID,
            ContourImageSequence
        };
        RTReferencedSeriesSequence.push(RTReferencedSeries);

        const RTReferencedStudySequence = [];

        const RTReferencedStudy = {
            ReferencedSOPClassUID: "1.2.840.10008.3.1.2.3.1", // Detached Study Management SOP Class
            ReferencedSOPInstanceUID: this.referencedDataset.StudyInstanceUID,
            RTReferencedSeriesSequence
        };

        RTReferencedStudySequence.push(RTReferencedStudy);

        const ReferencedFrameOfReference = {
            FrameOfReferenceUID,
            RTReferencedStudySequence
        };
        ReferencedFrameOfReferenceSequence.push(ReferencedFrameOfReference);
    }

    /**
     * addContour - Adds a new ROI with related contours to ROIContourSequence
     *
     * @param {Object} newContour cornerstoneTools `ROIContour` object
     *
     * newContour = {
     *   name: string,
     *   description: string,
     *   contourSequence: array[contour]
     * }
     *
     * contour = {
     *   ContourImageSequence: array[
     *       { ReferencedSOPClassUID: string, ReferencedSOPInstanceUID: string}
     *     ]
     *   ContourGeometricType: string,
     *   NumberOfContourPoints: number,
     *   ContourData: array[number]
     * }
     */
    addContour(newContour) {
        // Start
        const dataset = this.dataset;

        // ROI set information
        const ReferencedFrameOfReferenceUID = this.referencedDataset
            .FrameOfReferenceUID;
        const StructureSetROISequence = dataset.StructureSetROISequence;

        const ROINumber = StructureSetROISequence.length + 1;

        const StructureSetROI = {
            ROINumber,
            ReferencedFrameOfReferenceUID,
            ROIName: newContour.name,
            ROIDescription: newContour.description,
            ROIGenerationAlgorithm: "MANUAL"
        };

        StructureSetROISequence.push(StructureSetROI);

        // Contour Data
        const ROIContourSequence = dataset.ROIContourSequence;

        const roiContour = {
            ROIDisplayColor: [255, 0, 0], // implement in tool?
            ContourSequence: newContour.contourSequence,
            ReferencedROINumber: ROINumber
        };

        ROIContourSequence.push(roiContour);

        // ROI Observation data
        //const RTROIObservationsSequence = dataset.RTROIObservationsSequence;
    }
}
