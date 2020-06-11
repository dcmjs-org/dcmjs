import MeasurementReport from "./MeasurementReport.js";
import TID300Point from "../../utilities/TID300/Point.js";

const ARROW_ANNOTATE = "ArrowAnnotate";

class ArrowAnnotate {
    constructor() {}

    static measurementContentToArrowAnnotateState(groupItemContent) {
        debugger;
        const lengthContent = groupItemContent.ContentSequence;
        const { ReferencedSOPSequence } = lengthContent.ContentSequence;
        const {
            ReferencedSOPInstanceUID,
            ReferencedFrameNumber
        } = ReferencedSOPSequence;
        const lengthState = {
            sopInstanceUid: ReferencedSOPInstanceUID,
            frameIndex: ReferencedFrameNumber || 0,
            length: groupItemContent.MeasuredValueSequence.NumericValue,
            toolType: Length.toolType
        };

        lengthState.handles = { start: {}, end: {} };
        [
            lengthState.handles.start.x,
            lengthState.handles.start.y,
            lengthState.handles.end.x,
            lengthState.handles.end.y
        ] = lengthContent.GraphicData;

        // TODO: Save textbox position in GraphicData
        lengthState.handles.textBox = {
            hasMoved: false,
            movesIndependently: false,
            drawnIndependently: true,
            allowedOutsideImage: true,
            hasBoundingBox: true
        };

        return lengthState;
    }

    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(measurementContent) {
        debugger;
        return measurementContent.map(
            ArrowAnnotate.measurementContentToArrowAnnotateState
        );
    }

    static getTID300RepresentationArguments(tool) {
        const points = [tool.handles.start];
        const HumanReadableTrackingIdentifier = tool.text;

        const trackingIdentifierTextValue = `cornerstoneTools@^4.0.0:ArrowAnnotate:${HumanReadableTrackingIdentifier}`;

        return { points, trackingIdentifierTextValue };
    }
}

ArrowAnnotate.toolType = ARROW_ANNOTATE;
ArrowAnnotate.utilityToolType = ARROW_ANNOTATE;
ArrowAnnotate.TID300Representation = TID300Point;
ArrowAnnotate.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    if (!TrackingIdentifier.includes(":")) {
        return false;
    }

    const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

    if (cornerstone4Tag !== CORNERSTONE_4_TAG) {
        return false;
    }

    return toolType === ARROW_ANNOTATE;
};

MeasurementReport.registerTool(ArrowAnnotate);

export default ArrowAnnotate;
