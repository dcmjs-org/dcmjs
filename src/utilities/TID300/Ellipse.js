import TID300Measurement from "./TID300Measurement.js";
import unit2CodingValue from "./unit2CodingValue.js";

/**
 * Expand an array of points stored as objects into
 * a flattened array of points
 *
 * @param params.points
 * @param params.use3DSpatialCoordinates indicates if it's 3D coordinates or not
 * @return {Array}
 */
function expandPoints({ points, use3DSpatialCoordinates }) {
    const allPoints = [];

    points.forEach(point => {
        allPoints.push(point.x);
        allPoints.push(point.y);
        if (use3DSpatialCoordinates) {
            allPoints.push(point.z);
        }
    });

    return allPoints;
}

export default class Ellipse extends TID300Measurement {
    contentItem() {
        const {
            points,
            use3DSpatialCoordinates = false,
            ReferencedSOPSequence,
            area,
            areaUnit
        } = this.props;

        const GraphicData = expandPoints({ points, use3DSpatialCoordinates });

        return this.getMeasurement([
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "G-D7FE",
                    CodingSchemeDesignator: "SRT",
                    CodeMeaning: "AREA"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(areaUnit),
                    NumericValue: area
                },
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
                    GraphicType: "ELLIPSE",
                    GraphicData,
                    ContentSequence: use3DSpatialCoordinates
                        ? undefined
                        : {
                              RelationshipType: "SELECTED FROM",
                              ValueType: "IMAGE",
                              ReferencedSOPSequence
                          }
                }
            }
        ]);
    }
}
