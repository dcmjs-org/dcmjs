import TID300Measurement from "./TID300Measurement.js";
import unit2CodingValue from "./unit2CodingValue.js";

export default class Bidirectional extends TID300Measurement {
    contentItem() {
        const {
            longAxis,
            shortAxis,
            longAxisLength,
            shortAxisLength,
            unit,
            use3DSpatialCoordinates = false,
            ReferencedSOPSequence
        } = this.props;

        const longAxisGraphicData = this.flattenPoints({
            points: [longAxis.point1, longAxis.point2],
            use3DSpatialCoordinates
        });
        const shortAxisGraphicData = this.flattenPoints({
            points: [shortAxis.point1, shortAxis.point2],
            use3DSpatialCoordinates
        });

        return this.getMeasurement([
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "G-A185",
                    CodingSchemeDesignator: "SRT",
                    CodeMeaning: "Long Axis"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(unit),
                    NumericValue: longAxisLength
                },
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
                    GraphicType: "POLYLINE",
                    GraphicData: longAxisGraphicData,
                    ContentSequence: use3DSpatialCoordinates
                        ? undefined
                        : {
                              RelationshipType: "SELECTED FROM",
                              ValueType: "IMAGE",
                              ReferencedSOPSequence
                          }
                }
            },
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "G-A186",
                    CodingSchemeDesignator: "SRT",
                    CodeMeaning: "Short Axis"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(unit),
                    NumericValue: shortAxisLength
                },
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
                    GraphicType: "POLYLINE",
                    GraphicData: shortAxisGraphicData,
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
