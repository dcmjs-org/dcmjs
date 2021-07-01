import MeasurementReport from "./MeasurementReport";
import TID300Polyline from "../../utilities/TID300/Polyline";
import CORNERSTONE_4_TAG from "./cornerstone4Tag";
import { toArray } from "../helpers.js";

const FREEHAND = "Freehand";
const FINDING = "121071";
const FINDING_SITE = "G-C0E3";
const COMMENT = "121106";
const TRACKING_IDENTIFIER = "112039";
const TRACKING_UNIQUE_IDENTIFIER = "112040";

const statNameMap = {
    Minimum: "min",
    Maximum: "max",
    Mean: "mean",
    "Standard Deviation": "stdDev"
};

class Freehand {
    constructor() {}

    static parseNumComponent(num) {
        const SCOORDGroup = toArray(num.ContentSequence).find(
            group => group.ValueType === "SCOORD"
        );
        const { ReferencedSOPSequence } = SCOORDGroup.ContentSequence;
        return {
            type: num.ConceptNameCodeSequence.CodeMeaning,
            value: num.MeasuredValueSequence.NumericValue,
            points: Freehand.extractPoints(SCOORDGroup.GraphicData),
            ReferencedSOPSequence: ReferencedSOPSequence
        };
    }

    static parseNumGroup(numGroup) {
        const stats = {};
        const scoords = [];
        const refs = [];

        numGroup.forEach(num => {
            const {
                type,
                value,
                points,
                ReferencedSOPSequence
            } = Freehand.parseNumComponent(num);
            scoords.push(points);
            refs.push(ReferencedSOPSequence);
            stats[statNameMap[type]] = value;
        });
        return { scoords, refs, stats };
    }

    static extractPoints(points) {
        const allPoints = [];

        for (let i = 0; i < points.length; i += 2) {
            // TODO z
            allPoints.push({ x: points[i], y: points[i + 1] });
        }

        return allPoints;
    }

    static measurementContentToLengthState(MeasurementGroup) {
        const { ContentSequence } = MeasurementGroup;

        const findingGroup = toArray(ContentSequence).find(
            group => group.ConceptNameCodeSequence.CodeValue === FINDING
        );

        const findingSiteGroups = toArray(ContentSequence).filter(
            group => group.ConceptNameCodeSequence.CodeValue === FINDING_SITE
        );

        const comment = toArray(ContentSequence).find(
            group => group.ConceptNameCodeSequence.CodeValue === COMMENT
        );

        const trackingIdentifier = toArray(ContentSequence).find(
            group =>
                group.ConceptNameCodeSequence.CodeValue === TRACKING_IDENTIFIER
        );

        const trackingUniqueIdentifier = toArray(ContentSequence).find(
            group =>
                group.ConceptNameCodeSequence.CodeValue ===
                TRACKING_UNIQUE_IDENTIFIER
        );
        const NUMGroup = toArray(ContentSequence).filter(
            group => group.ValueType === "NUM"
        );
        const { scoords, refs, stats } = Freehand.parseNumGroup(NUMGroup);
        // TODO get/handle distinct shapes. using the first shape for now
        const state = {
            sopInstanceUid: refs[0].ReferencedSOPInstanceUID,
            frameIndex: refs[0].ReferencedFrameNumber || 0,
            toolType: Freehand.toolType,
            handles: {
                points: scoords[0],
                textBox: {},
                invalidHandlePlacement: false
            },
            active: false,
            visible: true,
            toolName: "Freehand",
            invalidated: false,
            finding: findingGroup
                ? findingGroup.ConceptCodeSequence
                : undefined,
            findingSites: findingSiteGroups.map(fsg => {
                return { ...fsg.ConceptCodeSequence };
            }),
            comment: comment ? comment.TextValue : undefined,
            trackingIdentifier: trackingIdentifier.TextValue,
            trackingUniqueIdentifier: trackingUniqueIdentifier.UID,
            meanStdDev: stats // TODO check if SUV/Pet
        };

        return state;
    }

    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(measurementContent) {
        return Freehand.measurementContentToLengthState(measurementContent);
    }

    static getTID300RepresentationArguments(tool) {
        const {
            handles,
            finding,
            findingSites,
            trackingIdentifier,
            perimeter,
            area,
            meanStdDev,
            meanStdDevSUV,
            pixelUnit
        } = tool;
        const points = handles.points;
        // console.error('tool', handles);
        const trackingIdentifierTextValue =
            trackingIdentifier || "cornerstoneTools@^4.0.0:Freehand";

        return {
            points,
            perimeter,
            area,
            meanStdDev,
            meanStdDevSUV,
            pixelUnit,
            trackingIdentifierTextValue,
            finding,
            findingSites: findingSites || []
        };
    }
}

Freehand.toolType = "Freehand";
Freehand.utilityToolType = "Freehand";
Freehand.TID300Representation = TID300Polyline;
Freehand.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    if (!TrackingIdentifier.includes(":")) {
        return false;
    }

    const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

    if (cornerstone4Tag !== CORNERSTONE_4_TAG) {
        return false;
    }

    return toolType === FREEHAND;
};

MeasurementReport.registerTool(Freehand);

export default Freehand;
