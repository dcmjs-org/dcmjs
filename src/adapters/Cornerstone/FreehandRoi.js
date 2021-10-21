import MeasurementReport from "./MeasurementReport";
import TID300Polyline from "../../utilities/TID300/Polyline";
import CORNERSTONE_4_TAG from "./cornerstone4Tag";

class FreehandRoi {
    constructor() {}

    static measurementContentToLengthState(groupItemContent) {
        const {
            defaultState,
            SCOORDGroup
        } = MeasurementReport.getSetupMeasurementData(MeasurementGroup);

        const state = {
            ...defaultState,
            toolType: FreehandRoi.toolType,
            handles: {
                points: [],
                textBox: {
                    active: false,
                    hasMoved: false,
                    movesIndependently: false,
                    drawnIndependently: true,
                    allowedOutsideImage: true,
                    hasBoundingBox: true
                }
            },
            color: undefined,
            invalidated: true
        };
        const { GraphicData } = SCOORDGroup;
        for (let i = 0; i < GraphicData.length; i += 2) {
            state.handles.points.push({
                x: GraphicData[i],
                y: GraphicData[i + 1]
            });
        }

        return state;
    }

    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(measurementContent) {
        return measurementContent.map(
            FreehandRoi.measurementContentToLengthState
        );
    }

    static getTID300RepresentationArguments(/*tool*/) {
        const { handles, finding, findingSites, cachedStats } = tool;
        const { points } = handles;
        const { area = 0, perimeter = 0 } = cachedStats;

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

FreehandRoi.toolType = "FreehandRoi";
FreehandRoi.utilityToolType = "FreehandRoi";
FreehandRoi.TID300Representation = TID300Polyline;
FreehandRoi.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    return false; // TODO
};

MeasurementReport.registerTool(FreehandRoi);

export default FreehandRoi;
