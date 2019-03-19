import MeasurementReport from "./MeasurementReport.js";
import TID300Polygon from "../../utilities/TID300/Polygon";

class Polygon {
    constructor() {}

    static getMeasurementData(measurementContent) {
        return measurementContent.ContentSequence.GraphicData;
    }

    static getTID300RepresentationArguments(scoord3d) {
        if (scoord3d.graphicType !== "POLYGON") {
            throw new Error("We expected a POLYGON graphicType");
        }

        const points = scoord3d.graphicData;
        const lengths = 1;

        return { points, lengths };
    }
}

Polygon.graphicType = "POLYGON";
Polygon.toolType = "Polygon";
Polygon.utilityToolType = "Polygon";
Polygon.TID300Representation = TID300Polygon;

MeasurementReport.registerTool(Polygon);

export default Polygon;
