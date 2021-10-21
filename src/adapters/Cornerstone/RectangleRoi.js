import MeasurementReport from "./MeasurementReport";
import TID300Polyline from "../../utilities/TID300/Polyline";
import CORNERSTONE_4_TAG from "./cornerstone4Tag";

class RectangleRoi {
    constructor() {}

    static measurementContentToLengthState(groupItemContent) {
        const {
            defaultState,
            SCOORDGroup
        } = MeasurementReport.getSetupMeasurementData(MeasurementGroup);

        const state = {
            ...defaultState,
            toolType: RectangleRoi.toolType,
            start: {},
            end: {},
            color: undefined,
            invalidated: true,
            initialRotation: 0,
            textBox: {
                active: false,
                hasMoved: false,
                movesIndependently: false,
                drawnIndependently: true,
                allowedOutsideImage: true,
                hasBoundingBox: true
            }
        };
        const intermediate = {};

        [
            state.start.x,
            state.start.y,
            intermediate.x,
            intermediate.y,
            state.end.x,
            state.end.y
        ] = SCOORDGroup.GraphicData;

        return state;
    }

    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(measurementContent) {
        return measurementContent.map(
            RectangleRoi.measurementContentToLengthState
        );
    }

    static getTID300RepresentationArguments(tool) {
        const { finding, findingSites, cachedStats, handles } = tool;
        console.log("getTID300 Rectangle", tool, cachedStats, handles);
        const { start, end } = handles;
        const points = [
            start,
            { x: start.x, y: end.y },
            end,
            { x: end.x, y: start.y }
        ];
        const { area, perimeter } = cachedStats;

        console.log("Point=", points, "cachedStats=", cachedStats);
        const trackingIdentifierTextValue =
            "cornerstoneTools@^4.0.0:RectangleRoi";

        return {
            points,
            area,
            perimeter,
            trackingIdentifierTextValue,
            finding,
            findingSites: findingSites || []
        };
    }
}

RectangleRoi.toolType = "RectangleRoi";
RectangleRoi.utilityToolType = "RectangleRoi";
RectangleRoi.TID300Representation = TID300Polyline;
RectangleRoi.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    return false; // TODO
};

MeasurementReport.registerTool(RectangleRoi);

export default RectangleRoi;
