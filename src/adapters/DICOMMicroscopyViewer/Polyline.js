import MeasurementReport from "./MeasurementReport.js";
import TID300Polyline from "../../utilities/TID300/Polyline";

class Polyline {
    constructor() {}

    static getMeasurementData(measurementContent) {
        return measurementContent.ContentSequence.GraphicData;
    }

    static getTID300RepresentationArguments(scoord3d) {
        if (scoord3d.graphicType !== "POLYLINE") {
            throw new Error("We expected a POLYLINE graphicType");
        }

        const points = scoord3d.graphicData;
        const lengths = 1;

        return { points, lengths };
    }
}

Polyline.graphicType = "POLYLINE";
Polyline.toolType = "Polyline";
Polyline.utilityToolType = "Polyline";
Polyline.TID300Representation = TID300Polyline;

MeasurementReport.registerTool(Polyline);

export default Polyline;
