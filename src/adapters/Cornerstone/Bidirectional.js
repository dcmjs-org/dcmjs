import MeasurementReport from "./MeasurementReport";
import TID300Bidirectional from "../../utilities/TID300/Bidirectional";
import CORNERSTONE_4_TAG from "./cornerstone4Tag";
import { toArray } from "../helpers.js";

const BIDIRECTIONAL = "Bidirectional";
const LONG_AXIS = "Long Axis";
const SHORT_AXIS = "Short Axis";

class Bidirectional {
    constructor() {}

    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(MeasurementGroup) {
        const { ContentSequence } = MeasurementGroup;

        const NUMGroups = toArray(ContentSequence).filter(
            group => group.ValueType === "NUM"
        );

        const longAxisNUMGroup = toArray(ContentSequence).find(
            group => group.ConceptNameCodeSequence.CodeMeaning === LONG_AXIS
        );

        const longAxisSCOORDGroup = toArray(
            longAxisNUMGroup.ContentSequence
        ).find(group => group.ValueType === "SCOORD");

        const shortAxisNUMGroup = toArray(ContentSequence).find(
            group => group.ConceptNameCodeSequence.CodeMeaning === SHORT_AXIS
        );

        const shortAxisSCOORDGroup = toArray(
            shortAxisNUMGroup.ContentSequence
        ).find(group => group.ValueType === "SCOORD");

        const { ReferencedSOPSequence } = longAxisSCOORDGroup.ContentSequence;
        const {
            ReferencedSOPInstanceUID,
            ReferencedFrameNumber
        } = ReferencedSOPSequence;

        // Long axis

        const longestDiameter = String(
            longAxisNUMGroup.MeasuredValueSequence.NumericValue
        );

        const shortestDiameter = String(
            shortAxisNUMGroup.MeasuredValueSequence.NumericValue
        );

        const state = {
            sopInstanceUid: ReferencedSOPInstanceUID,
            frameIndex: ReferencedFrameNumber || 1,
            toolType: Bidirectional.toolType,
            active: false,
            handles: {
                start: {
                    x: longAxisSCOORDGroup.GraphicData[0],
                    y: longAxisSCOORDGroup.GraphicData[1],
                    drawnIndependently: false,
                    allowedOutsideImage: false
                },
                end: {
                    x: longAxisSCOORDGroup.GraphicData[2],
                    y: longAxisSCOORDGroup.GraphicData[3],
                    drawnIndependently: false,
                    allowedOutsideImage: false
                },
                perpendicularStart: {
                    x: shortAxisSCOORDGroup.GraphicData[0],
                    y: shortAxisSCOORDGroup.GraphicData[1],
                    drawnIndependently: false,
                    allowedOutsideImage: false
                },
                perpendicularEnd: {
                    x: shortAxisSCOORDGroup.GraphicData[2],
                    y: shortAxisSCOORDGroup.GraphicData[3],
                    drawnIndependently: false,
                    allowedOutsideImage: false
                },

                textBox: {
                    hasMoved: false,
                    movesIndependently: false,
                    drawnIndependently: true,
                    allowedOutsideImage: true,
                    hasBoundingBox: true
                }
            },
            invalidated: false,
            isCreating: false,
            longestDiameter,
            shortestDiameter,
            toolType: "Bidirectional",
            visible: true
        };

        // TODO: To be implemented!
        // Needs to add longAxis, shortAxis, longAxisLength, shortAxisLength

        return state;
    }

    static getTID300RepresentationArguments(tool) {
        const {
            start,
            end,
            perpendicularStart,
            perpendicularEnd
        } = tool.handles;
        const { shortestDiameter, longestDiameter } = tool;

        const trackingIdentifierTextValue =
            "cornerstoneTools@^4.0.0:Bidirectional";

        return {
            longAxis: {
                point1: start,
                point2: end
            },
            shortAxis: {
                point1: perpendicularStart,
                point2: perpendicularEnd
            },
            longAxisLength: longestDiameter,
            shortAxisLength: shortestDiameter,
            trackingIdentifierTextValue
        };
    }
}

Bidirectional.toolType = BIDIRECTIONAL;
Bidirectional.utilityToolType = BIDIRECTIONAL;
Bidirectional.TID300Representation = TID300Bidirectional;
Bidirectional.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    if (!TrackingIdentifier.includes(":")) {
        return false;
    }

    const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

    if (cornerstone4Tag !== CORNERSTONE_4_TAG) {
        return false;
    }

    return toolType === BIDIRECTIONAL;
};

MeasurementReport.registerTool(Bidirectional);

export default Bidirectional;
