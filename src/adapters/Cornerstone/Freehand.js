import MeasurementReport from "./MeasurementReport";
import TID300Polygon from "../../utilities/TID300/Polygon";

class Freehand {
  constructor() {
  }

  static measurementContentToLengthState(groupItemContent) {
    const content = groupItemContent.ContentSequence;
    const { ReferencedSOPSequence } = content.ContentSequence;
    const { ReferencedSOPInstanceUID, ReferencedFrameNumber } = ReferencedSOPSequence
    const state = {
      sopInstanceUid: ReferencedSOPInstanceUID,
      frameIndex: ReferencedFrameNumber || 0,
      toolType: Freehand.toolType,
    };

    // TODO: To be implemented!
    // Needs to add points, lengths

    return state;
  }

  // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
  static getMeasurementData(measurementContent) {
    return measurementContent.map(Freehand.measurementContentToLengthState);
  }

  static getTID300RepresentationArguments(tool) {
    // TO BE IMPLEMENTED
    return {points, lengths};
  }
}

Freehand.toolType = 'Freehand';
Freehand.utilityToolType = 'Polygon';
Freehand.TID300Representation = TID300Polygon;

MeasurementReport.registerTool(Freehand);

export default Freehand;
