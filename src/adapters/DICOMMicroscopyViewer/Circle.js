import MeasurementReport from "./MeasurementReport.js";
import TID300Circle from "../../utilities/TID300/Circle";

class Circle {
    constructor() {}

    static getMeasurementData(measurementContent) {
        return measurementContent.ContentSequence.GraphicData;
    }

    static getTID300RepresentationArguments(scoord3d) {
        if (scoord3d.graphicType !== "CIRCLE") {
            throw new Error("We expected a CIRCLE graphicType");
        }

        const points = scoord3d.graphicData;
        const lengths = 1;

        return { points, lengths };
    }
}

Circle.graphicType = "CIRCLE";
Circle.toolType = "Circle";
Circle.utilityToolType = "Circle";
Circle.TID300Representation = TID300Circle;

MeasurementReport.registerTool(Circle);

export default Circle;
