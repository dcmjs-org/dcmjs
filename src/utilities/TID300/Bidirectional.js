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

        const longAxisGraphicData = use3DSpatialCoordinates
            ? [
                  longAxis.point1.x,
                  longAxis.point1.y,
                  longAxis.point1.z,
                  longAxis.point2.x,
                  longAxis.point2.y,
                  longAxis.point2.z
              ]
            : [
                  longAxis.point1.x,
                  longAxis.point1.y,
                  longAxis.point2.x,
                  longAxis.point2.y
              ];

        const shortAxisGraphicData = use3DSpatialCoordinates
            ? [
                  shortAxis.point1.x,
                  shortAxis.point1.y,
                  shortAxis.point1.z,
                  shortAxis.point2.x,
                  shortAxis.point2.y,
                  shortAxis.point2.z
              ]
            : [
                  shortAxis.point1.x,
                  shortAxis.point1.y,
                  shortAxis.point2.x,
                  shortAxis.point2.y
              ];

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
