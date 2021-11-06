import MeasurementReport from "./MeasurementReport";
import TID300Rectangle from "../../utilities/TID300/Rectangle";
import CORNERSTONE_4_TAG from "./cornerstone4Tag";
import EllipticalRoi from "./EllipticalRoi";

const RECT = "RectangleRoi";

class RectangleRoi extends EllipticalRoi {
    static getMeasurementData(MeasurementGroup) {
        const ellipState = super.getMeasurementData(MeasurementGroup);

        let rectState = {
            toolName: RECT,
            toolType: RectangleRoi.toolType
        };

        rectState = Object.assign(ellipState, rectState);

        return rectState;
    }

    static getTID300RepresentationArguments(tool) {
        const TID300Rep = super.getTID300RepresentationArguments(tool);

        const trackingIdentifierTextValue = CORNERSTONE_4_TAG + ":" + RECT;

        return Object.assign(TID300Rep, {
            trackingIdentifierTextValue
        });
    }
}

RectangleRoi.toolType = RECT;
RectangleRoi.utilityToolType = RECT;
RectangleRoi.TID300Representation = TID300Rectangle;
RectangleRoi.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    if (!TrackingIdentifier.includes(":")) {
        return false;
    }

    const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

    if (cornerstone4Tag !== CORNERSTONE_4_TAG) {
        return false;
    }

    return toolType === RECT;
};

MeasurementReport.registerTool(RectangleRoi);

export default RectangleRoi;
