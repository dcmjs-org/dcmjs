import TID300Measurement from "./TID300Measurement.js";
import unit2CodingValue from "./unit2CodingValue.js";

export default class Calibration extends TID300Measurement {
    contentItem() {
        const {
            point1,
            point2,
            unit = "mm",
            use3DSpatialCoordinates = false,
            distance,
            ReferencedSOPSequence
        } = this.props;

        const GraphicData = use3DSpatialCoordinates
            ? [point1.x, point1.y, point1.z, point2.x, point2.y, point2.z]
            : [point1.x, point1.y, point2.x, point2.y];

        return this.getMeasurement([
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "102304005",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Calibration Ruler"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(unit),
                    NumericValue: distance
                },
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
                    GraphicType: "POLYLINE",
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
