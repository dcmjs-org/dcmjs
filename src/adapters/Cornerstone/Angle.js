import MeasurementReport from "./MeasurementReport.js";
import TID300Angle from "../../utilities/TID300/Angle.js";
import CORNERSTONE_4_TAG from "./cornerstone4Tag";
import GenericTool from "./GenericTool.js";

const ANGLE = "Angle";

class Angle extends GenericTool {
    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(MeasurementGroup) {
        const toolState = super.getMeasurementData(MeasurementGroup);

        const { ContentSequence } = MeasurementGroup;

        const NUMGroup = this.getNumericContent(ContentSequence);

        const SCOORDGroup = this.getScoordContent(ContentSequence);

        let angleState = {
            handles: {
                start: {},
                middle: {},
                end: {},
                textBox: {
                    hasMoved: false,
                    movesIndependently: false,
                    drawnIndependently: true,
                    allowedOutsideImage: true,
                    hasBoundingBox: true
                }
            },
            rAngle: NUMGroup.MeasuredValueSequence.NumericValue,
            toolName: ANGLE,
            toolType: Angle.toolType
        };

        [
            angleState.handles.start.x,
            angleState.handles.start.y,
            angleState.handles.middle.x,
            angleState.handles.middle.y,
            angleState.handles.end.x,
            angleState.handles.end.y
        ] = SCOORDGroup.GraphicData;

        angleState = Object.assign(toolState, angleState);

        return angleState;
    }

    static getTID300RepresentationArguments(tool) {
        const TID300Rep = super.getTID300RepresentationArguments(tool);
        const { handles } = tool;
        const point1 = handles.start;
        const point2 = handles.middle;
        const point3 = handles.end;
        const rAngle = tool.rAngle;

        const trackingIdentifierTextValue = CORNERSTONE_4_TAG + ":" + ANGLE;

        return Object.assign(TID300Rep, {
            point1,
            point2,
            point3,
            rAngle,
            trackingIdentifierTextValue
        });
    }
}

Angle.toolType = ANGLE;
Angle.utilityToolType = ANGLE;
Angle.TID300Representation = TID300Angle;
Angle.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    if (!TrackingIdentifier.includes(":")) {
        return false;
    }

    const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

    if (cornerstone4Tag !== CORNERSTONE_4_TAG) {
        return false;
    }

    return toolType === ANGLE;
};

MeasurementReport.registerTool(Angle);

export default Angle;
