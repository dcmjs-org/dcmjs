import MeasurementReport from "./MeasurementReport.js";
import TID300CobbAngle from "../../utilities/TID300/CobbAngle.js";
import CORNERSTONE_4_TAG from "./cornerstone4Tag";
import { toArray } from "../helpers.js";

const COBB_ANGLE = "CobbAngle";
const FINDING = "121071";
const FINDING_SITE = "G-C0E3";

class CobbAngle {
    constructor() {}

    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(MeasurementGroup) {
        const { ContentSequence } = MeasurementGroup;

        const findingGroup = toArray(ContentSequence).find(
            group => group.ConceptNameCodeSequence.CodeValue === FINDING
        );

        const findingSiteGroups = toArray(ContentSequence).filter(
            group => group.ConceptNameCodeSequence.CodeValue === FINDING_SITE
        );

        const NUMGroup = toArray(ContentSequence).find(
            group => group.ValueType === "NUM"
        );

        const SCOORDGroup = toArray(NUMGroup.ContentSequence).find(
            group => group.ValueType === "SCOORD"
        );

        const { ReferencedSOPSequence } = SCOORDGroup.ContentSequence;
        const {
            ReferencedSOPInstanceUID,
            ReferencedFrameNumber
        } = ReferencedSOPSequence;
        const state = {
            sopInstanceUid: ReferencedSOPInstanceUID,
            frameIndex: ReferencedFrameNumber || 1,
            rAngle: NUMGroup.MeasuredValueSequence.NumericValue,
            toolType: CobbAngle.toolType,
            handles: {
                start: {},
                end: {},
                start2: {
                    highlight: true,
                    drawnIndependently: true
                },
                end2: {
                    highlight: true,
                    drawnIndependently: true
                },
                textBox: {
                    hasMoved: false,
                    movesIndependently: false,
                    drawnIndependently: true,
                    allowedOutsideImage: true,
                    hasBoundingBox: true
                }
            },
            complete: true,
            finding: findingGroup
                ? findingGroup.ConceptCodeSequence
                : undefined,
            findingSites: findingSiteGroups.map(fsg => {
                return { ...fsg.ConceptCodeSequence };
            })
        };

        [
            state.handles.start.x,
            state.handles.start.y,
            state.handles.end.x,
            state.handles.end.y,
            state.handles.start2.x,
            state.handles.start2.y,
            state.handles.end2.x,
            state.handles.end2.y
        ] = SCOORDGroup.GraphicData;

        return state;
    }

    static getTID300RepresentationArguments(tool) {
        const { handles, finding, findingSites } = tool;
        const point1 = handles.start;
        const point2 = handles.end;
        const point3 = handles.start2;
        const point4 = handles.end2;
        const rAngle = tool.rAngle;

        const trackingIdentifierTextValue = "cornerstoneTools@^4.0.0:CobbAngle";

        return {
            point1,
            point2,
            point3,
            point4,
            rAngle,
            trackingIdentifierTextValue,
            finding,
            findingSites: findingSites || []
        };
    }
}

CobbAngle.toolType = COBB_ANGLE;
CobbAngle.utilityToolType = COBB_ANGLE;
CobbAngle.TID300Representation = TID300CobbAngle;
CobbAngle.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    if (!TrackingIdentifier.includes(":")) {
        return false;
    }

    const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

    if (cornerstone4Tag !== CORNERSTONE_4_TAG) {
        return false;
    }

    return toolType === COBB_ANGLE;
};

MeasurementReport.registerTool(CobbAngle);

export default CobbAngle;
