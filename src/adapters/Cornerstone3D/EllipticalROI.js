import MeasurementReport from "./MeasurementReport";
import TID300Ellipse from "../../utilities/TID300/Ellipse";
import CORNERSTONE_3D_TAG from "./cornerstone3DTag";

const ELLIPTICALROI = "EllipticalROI";
const FINDING = "121071";
const FINDING_SITE = "G-C0E3";

const trackingIdentifierTextValue = "Cornerstone3DTools@^0.1.0:EllipticalROI";

class EllipticalROI {
    constructor() {}

    static getMeasurementData(MeasurementGroup, imageId, imageToWorldCoords) {
        const {
            defaultState,
            NUMGroup,
            SCOORDGroup
        } = MeasurementReport.getSetupMeasurementData(MeasurementGroup);

        const { GraphicData } = SCOORDGroup;

        // GraphicData is ordered as [majorAxisStartX, majorAxisStartY, majorAxisEndX, majorAxisEndY, minorAxisStartX, minorAxisStartY, minorAxisEndX, minorAxisEndY]
        // But Cornerstone3D points are ordered as top, bottom, left, right for the
        // ellipse so we need to identify if the majorAxis is horizontal or vertical
        // and then choose the correct points to use for the ellipse.

        const majorAxisStart = { x: GraphicData[0], y: GraphicData[1] };
        const majorAxisEnd = { x: GraphicData[2], y: GraphicData[3] };
        const minorAxisStart = { x: GraphicData[4], y: GraphicData[5] };
        const minorAxisEnd = { x: GraphicData[6], y: GraphicData[7] };

        const majorAxisIsHorizontal = majorAxisStart.y === majorAxisEnd.y;
        const majorAxisIsVertical = majorAxisStart.x === majorAxisEnd.x;

        let ellipsePointsImage;

        if (majorAxisIsVertical) {
            ellipsePointsImage = [
                majorAxisStart.x,
                majorAxisStart.y,
                majorAxisEnd.x,
                majorAxisEnd.y,
                minorAxisStart.x,
                minorAxisStart.y,
                minorAxisEnd.x,
                minorAxisEnd.y
            ];
        } else if (majorAxisIsHorizontal) {
            ellipsePointsImage = [
                minorAxisStart.x,
                minorAxisStart.y,
                minorAxisEnd.x,
                minorAxisEnd.y,
                majorAxisStart.x,
                majorAxisStart.y,
                majorAxisEnd.x,
                majorAxisEnd.y
            ];
        } else {
            throw new Error("ROTATED ELLIPSE NOT YET SUPPORTED");
        }

        const points = [];
        for (let i = 0; i < ellipsePointsImage.length; i += 2) {
            const worldPos = imageToWorldCoords(imageId, [
                ellipsePointsImage[i],
                ellipsePointsImage[i + 1]
            ]);

            points.push(worldPos);
        }

        const state = {
            ...defaultState,
            toolType: EllipticalROI.toolType,
            data: {
                handles: {
                    points: [...points],
                    activeHandleIndex: 0,
                    textBox: {
                        hasMoved: false
                    }
                },
                cachedStats: {
                    [`imageId:${imageId}`]: {
                        area: NUMGroup.MeasuredValueSequence.NumericValue
                    }
                }
            }
        };
        return state;
    }

    static getTID300RepresentationArguments(tool, worldToImageCoords) {
        const { data, finding, findingSites, metadata } = tool;
        const { cachedStats, handles } = data;

        const { referencedImageId } = metadata;

        if (!referencedImageId) {
            throw new Error(
                "EllipticalROI.getTID300RepresentationArguments: referencedImageId is not defined"
            );
        }

        const top = worldToImageCoords(referencedImageId, handles.points[0]);
        const bottom = worldToImageCoords(referencedImageId, handles.points[1]);
        const left = worldToImageCoords(referencedImageId, handles.points[2]);
        const right = worldToImageCoords(referencedImageId, handles.points[3]);

        // find the major axis and minor axis
        const topBottomLength = Math.abs(top[1] - bottom[1]);
        const leftRightLength = Math.abs(left[0] - right[0]);

        let points = [];
        if (topBottomLength > leftRightLength) {
            // major axis is bottom to top
            points.push({ x: top[0], y: top[1] });
            points.push({ x: bottom[0], y: bottom[1] });

            // minor axis is left to right
            points.push({ x: left[0], y: left[1] });
            points.push({ x: right[0], y: right[1] });
        } else {
            // major axis is left to right
            points.push({ x: left[0], y: left[1] });
            points.push({ x: right[0], y: right[1] });

            // minor axis is bottom to top
            points.push({ x: top[0], y: top[1] });
            points.push({ x: bottom[0], y: bottom[1] });
        }

        const { area } = cachedStats[`imageId:${referencedImageId}`];

        return {
            area,
            points,
            trackingIdentifierTextValue,
            finding,
            findingSites: findingSites || []
        };
    }
}

EllipticalROI.toolType = ELLIPTICALROI;
EllipticalROI.utilityToolType = ELLIPTICALROI;
EllipticalROI.TID300Representation = TID300Ellipse;
EllipticalROI.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    if (!TrackingIdentifier.includes(":")) {
        return false;
    }

    const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

    if (cornerstone4Tag !== CORNERSTONE_3D_TAG) {
        return false;
    }

    return toolType === ELLIPTICALROI;
};

MeasurementReport.registerTool(EllipticalROI);

export default EllipticalROI;
