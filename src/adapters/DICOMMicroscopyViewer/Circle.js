import MeasurementReport from "./MeasurementReport.js";
import TID300Circle from "../../utilities/TID300/Circle";

class Circle {
    constructor() {}

    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(measurementContent) {
        return measurementContent.ContentSequence.GraphicData;
    }

    // Expects a Circle scoord from dicom-microscopy-viewer? Check arguments?
    static getTID300RepresentationArguments(scoord) {
        if (scoord.graphicType !== "CIRCLE") {
            throw new Error("We expected a CIRCLE graphicType");
        }

        const points = scoord.graphicData;
        const lengths = 1; // scoord.distances[0];

        // FROM dicom-microscopy-viewer format TO dcmjs adapter format

        return { points, lengths };
    }
}

// TODO: Using dicom-microscopy-viewer's graphic type may not work since both lines and circles are both CIRCLES
// Might make more sense to just use a circle adapter instead of 'length' and 'circle'
Circle.graphicType = "CIRCLE";
Circle.toolType = "Circle";
Circle.utilityToolType = "Circle";
Circle.TID300Representation = TID300Circle;

MeasurementReport.registerTool(Circle);

export default Circle;
