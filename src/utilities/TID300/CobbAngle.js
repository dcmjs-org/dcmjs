import TID300Measurement from "./TID300Measurement.js";

export default class CobbAngle extends TID300Measurement {
    contentItem() {
        const {
            point1,
            point2,
            point3,
            point4,
            rAngle,
            use3DSpatialCoordinates,
            ReferencedSOPSequence
        } = this.props;

        const GraphicData = this.flattenPoints({
            points: [point1, point2, point3, point4],
            use3DSpatialCoordinates
        });

        return this.getMeasurement([
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "285285000",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Cobb angle"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: {
                        CodeValue: "deg",
                        CodingSchemeDesignator: "UCUM",
                        CodingSchemeVersion: "1.4",
                        CodeMeaning: "\u00B0"
                    },
                    NumericValue: rAngle
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
