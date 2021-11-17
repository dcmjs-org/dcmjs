import MeasurementReport from "./MeasurementReport.js";
import TID300Point from "../../utilities/TID300/Point.js";
import CORNERSTONE_4_TAG from "./cornerstone4Tag";
import { toArray } from "../helpers.js";
import GenericTool from "./GenericTool.js";

const ARROW_ANNOTATE = "ArrowAnnotate";
const FINDING = "121071";
const CORNERSTONEFREETEXT = "CORNERSTONEFREETEXT";

class ArrowAnnotate extends GenericTool {
    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(MeasurementGroup) {
        const toolState = super.getMeasurementData(MeasurementGroup);

        const { ContentSequence } = MeasurementGroup;

        const SCOORDGroup = this.getScoordContent(ContentSequence);

        const findingGroup = toArray(ContentSequence).find(
            group => group.ConceptNameCodeSequence.CodeValue === FINDING
        );

        const text = findingGroup.ConceptCodeSequence.CodeMeaning;

        const { GraphicData } = SCOORDGroup;

        let arrowState = {
            handles: {
                start: {
                    x: GraphicData[0],
                    y: GraphicData[1],
                    highlight: true,
                    active: false
                },
                // TODO: How do we choose where the end goes?
                // Just put it pointing from the bottom right for now?
                end: {
                    x: GraphicData[2],
                    y: GraphicData[3],
                    highlight: true,
                    active: false
                },
                textBox: {
                    hasMoved: false,
                    movesIndependently: false,
                    drawnIndependently: true,
                    allowedOutsideImage: true,
                    hasBoundingBox: true
                }
            },
            text,
            toolName: ARROW_ANNOTATE,
            toolType: ArrowAnnotate.toolType
        };

        if (GraphicData.length === 6) {
            arrowState.handles.start.x = GraphicData[0];
            arrowState.handles.start.y = GraphicData[1];
            arrowState.handles.start.z = GraphicData[2];
            arrowState.handles.end.x = GraphicData[3];
            arrowState.handles.end.y = GraphicData[4];
            arrowState.handles.end.z = GraphicData[5];
        }

        arrowState = Object.assign(toolState, arrowState);

        return arrowState;
    }

    static getTID300RepresentationArguments(tool) {
        const points = [tool.handles.start, tool.handles.end];

        let { finding, findingSites } = tool;

        const TID300RepresentationArguments = {
            points,
            trackingIdentifierTextValue:
                CORNERSTONE_4_TAG + ":" + ARROW_ANNOTATE,
            findingSites: findingSites || []
        };

        // If freetext finding isn't present, add it from the tool text.
        if (!finding || finding.CodeValue !== CORNERSTONEFREETEXT) {
            finding = {
                CodeValue: CORNERSTONEFREETEXT,
                CodingSchemeDesignator: "CST4",
                CodeMeaning: tool.text
            };
        }

        TID300RepresentationArguments.finding = finding;

        return TID300RepresentationArguments;
    }

    static checkMeasurementIntegrity(tool) {
        if (tool.hasOwnProperty("text")) {
            return true;
        } else {
            return false;
        }
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
