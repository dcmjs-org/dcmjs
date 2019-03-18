import MeasurementReport from "./MeasurementReport.js";
import TID300Point from "../../utilities/TID300/Point";

class Point {
    constructor() {}

    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(measurementContent) {
        return measurementContent.ContentSequence.GraphicData;
    }

    // Expects a Point scoord from dicom-microscopy-viewer? Check arguments?
    static getTID300RepresentationArguments(scoord) {
        if (scoord.graphicType !== "POINT") {
            throw new Error("We expected a POINT graphicType");
        }

        const points = [scoord.graphicData];
        const lengths = 1; // scoord.distances[0];

        // FROM dicom-microscopy-viewer format TO dcmjs adapter format

        return { points, lengths };
    }
}

// TODO: Using dicom-microscopy-viewer's graphic type may not work since both lines and points are both POLYLINES
// Might make more sense to just use a point adapter instead of 'length' and 'point'
Point.graphicType = "POINT";
Point.toolType = "Point";
Point.utilityToolType = "Point";
Point.TID300Representation = TID300Point;

MeasurementReport.registerTool(Point);

export default Point;
