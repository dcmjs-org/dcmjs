import MeasurementReport from "./MeasurementReport.js";
import TID300Polygon from "../../utilities/TID300/Polygon";

class Polygon {
    constructor() {}

    // TODO: this function is required for all Cornerstone Tool Adapters, since it is called by MeasurementReport.
    static getMeasurementData(measurementContent) {
        return measurementContent.ContentSequence.GraphicData;
    }

    // Expects a Polygon scoord from dicom-microscopy-viewer? Check arguments?
    static getTID300RepresentationArguments(scoord) {
        if (scoord.graphicType !== "POLYGON") {
            throw new Error("We expected a POLYGON graphicType");
        }

        const points = scoord.graphicData;
        const lengths = 1; // scoord.distances[0];

        // FROM dicom-microscopy-viewer format TO dcmjs adapter format

        return { points, lengths };
    }
}

// TODO: Using dicom-microscopy-viewer's graphic type may not work since both lines and polygons are both POLYLINES
// Might make more sense to just use a polygon adapter instead of 'length' and 'polygon'
Polygon.graphicType = "POLYGON";
Polygon.toolType = "Polygon";
Polygon.utilityToolType = "Polygon";
Polygon.TID300Representation = TID300Polygon;

MeasurementReport.registerTool(Polygon);

export default Polygon;
