import TID300Measurement from "./TID300Measurement.js";
import unit2CodingValue from "./unit2CodingValue.js";
import buildContentSequence from "./buildContentSequence.js";

export default class Circle extends TID300Measurement {
    contentItem() {
        const {
            points,
            ReferencedSOPSequence,
            use3DSpatialCoordinates = false,
            perimeter,
            area,
            areaUnit = "mm2",
            unit = "mm",
            max,
            min,
            mean,
            stdDev,
            radiusUnit,
            modalityUnit,
            ReferencedFrameOfReferenceUID,
            radius
        } = this.props;

        // Combine all lengths to save the perimeter
        // @ToDO The permiter has to be implemented
        // const reducer = (accumulator, currentValue) => accumulator + currentValue;
        // const perimeter = lengths.reduce(reducer);
        const GraphicData = this.flattenPoints({
            points,
            use3DSpatialCoordinates
        });

        const measurements = [
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "G-A197",
                    CodingSchemeDesignator: "SRT",
                    CodeMeaning: "Perimeter" // TODO: Look this up from a Code Meaning dictionary
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(unit),
                    NumericValue: perimeter
                },
                ContentSequence: buildContentSequence({
                    graphicType: "CIRCLE",
                    graphicData: GraphicData,
                    use3DSpatialCoordinates,
                    referencedSOPSequence: ReferencedSOPSequence,
                    referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
                })
            },
            {
                // TODO: This feels weird to repeat the GraphicData
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "G-A166",
                    CodingSchemeDesignator: "SRT",
                    CodeMeaning: "Area" // TODO: Look this up from a Code Meaning dictionary
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(areaUnit),
                    NumericValue: area
                },
                ContentSequence: buildContentSequence({
                    graphicType: "CIRCLE",
                    graphicData: GraphicData,
                    use3DSpatialCoordinates,
                    referencedSOPSequence: ReferencedSOPSequence,
                    referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
                })
            }
        ];
        if (radius) {
            measurements.push({
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "131190003",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Radius"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(radiusUnit),
                    NumericValue: radius
                },
                ContentSequence: buildContentSequence({
                    graphicType: "CIRCLE",
                    graphicData: GraphicData,
                    use3DSpatialCoordinates,
                    referencedSOPSequence: ReferencedSOPSequence,
                    referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
                })
            });
        }

        if (max) {
            measurements.push({
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "56851009",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Maximum"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence:
                        unit2CodingValue(modalityUnit),
                    NumericValue: max
                },
                ContentSequence: buildContentSequence({
                    graphicType: "CIRCLE",
                    graphicData: GraphicData,
                    use3DSpatialCoordinates,
                    referencedSOPSequence: ReferencedSOPSequence,
                    referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
                })
            });
        }

        if (min) {
            measurements.push({
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "255605001",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Minimum"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence:
                        unit2CodingValue(modalityUnit),
                    NumericValue: min
                },
                ContentSequence: buildContentSequence({
                    graphicType: "CIRCLE",
                    graphicData: GraphicData,
                    use3DSpatialCoordinates,
                    referencedSOPSequence: ReferencedSOPSequence,
                    referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
                })
            });
        }

        if (mean) {
            measurements.push({
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "373098007",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Mean"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence:
                        unit2CodingValue(modalityUnit),
                    NumericValue: mean
                },
                ContentSequence: buildContentSequence({
                    graphicType: "CIRCLE",
                    graphicData: GraphicData,
                    use3DSpatialCoordinates,
                    referencedSOPSequence: ReferencedSOPSequence,
                    referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
                })
            });
        }

        if (stdDev) {
            measurements.push({
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "386136009",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Standard Deviation"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence:
                        unit2CodingValue(modalityUnit),
                    NumericValue: stdDev
                },
                ContentSequence: buildContentSequence({
                    graphicType: "CIRCLE",
                    graphicData: GraphicData,
                    use3DSpatialCoordinates,
                    referencedSOPSequence: ReferencedSOPSequence,
                    referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
                })
            });
        }
        return this.getMeasurement(measurements);
    }
}
