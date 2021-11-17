import MeasurementReport from "./MeasurementReport.js";
import TID300Length from "../../utilities/TID300/Length.js";
import CORNERSTONE_4_TAG from "./cornerstone4Tag";
import GenericTool from "./GenericTool.js";

const LENGTH = "Length";

class Length extends GenericTool {
    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(MeasurementGroup) {
        const toolState = super.getMeasurementData(MeasurementGroup);

        const { ContentSequence } = MeasurementGroup;

        const NUMGroup = this.getNumericContent(ContentSequence);

        const SCOORDGroup = this.getScoordContent(ContentSequence);

        let lengthState = {
            handles: {
                start: {},
                end: {},
                textBox: {
                    hasMoved: false,
                    movesIndependently: false,
                    drawnIndependently: true,
                    allowedOutsideImage: true,
                    hasBoundingBox: true
                }
            },
            length: NUMGroup.MeasuredValueSequence.NumericValue,
            toolName: LENGTH,
            toolType: Length.toolType
        };

        [
            lengthState.handles.start.x,
            lengthState.handles.start.y,
            lengthState.handles.end.x,
            lengthState.handles.end.y
        ] = SCOORDGroup.GraphicData;

        lengthState = Object.assign(toolState, lengthState);

        return lengthState;
    }

    static getTID300RepresentationArguments(tool) {
        const TID300Rep = super.getTID300RepresentationArguments(tool);
        const { handles } = tool;
        const point1 = handles.start;
        const point2 = handles.end;
        const distance = tool.length;

        const trackingIdentifierTextValue = CORNERSTONE_4_TAG + ":" + LENGTH;

        return Object.assign(TID300Rep, {
            distance,
            point1,
            point2,
            trackingIdentifierTextValue
        });
    }

    static checkMeasurementIntegrity(tool) {
        if (tool.hasOwnProperty("length")) {
            return true;
        } else {
            return false;
        }
    }
}

Length.toolType = LENGTH;
Length.utilityToolType = LENGTH;
Length.TID300Representation = TID300Length;
Length.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    if (!TrackingIdentifier.includes(":")) {
        return false;
    }

    const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

    if (cornerstone4Tag !== CORNERSTONE_4_TAG) {
        return false;
    }

    return toolType === LENGTH;
};

MeasurementReport.registerTool(Length);

export default Length;
