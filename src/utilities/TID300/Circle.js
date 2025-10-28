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
            ReferencedFrameOfReferenceUID
        } = this.props;

        // Combine all lengths to save the perimeter
        // @ToDO The permiter has to be implemented
        // const reducer = (accumulator, currentValue) => accumulator + currentValue;
        // const perimeter = lengths.reduce(reducer);
        const GraphicData = this.flattenPoints({
            points,
            use3DSpatialCoordinates
        });

        const graphicContentSequence = buildContentSequence({
            graphicType: "CIRCLE",
            graphicData: GraphicData,
            use3DSpatialCoordinates,
            referencedSOPSequence: ReferencedSOPSequence,
            referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
        });

        return this.getMeasurement([
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
                ContentSequence: graphicContentSequence
            },
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "131190003",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Radius"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(radiusUnit),
                    NumericValue: perimeter
                },
                ContentSequence: graphicContentSequence
            },
            {
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
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
                    GraphicType: "CIRCLE",
                    GraphicData,
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
                    CodeValue: "56851009",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Maximum"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: modalityUnit,
                    NumericValue: max
                },
                ContentSequence: graphicContentSequence
            },
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "255605001",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Minimum"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: modalityUnit,
                    NumericValue: min
                },
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
                    GraphicType: "CIRCLE",
                    GraphicData,
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
                    CodeValue: "373098007",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Mean"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: modalityUnit,
                    NumericValue: mean
                },
                ContentSequence: graphicContentSequence
            },
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "386136009",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Standard Deviation"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: modalityUnit,
                    NumericValue: stdDev
                },
                ContentSequence: graphicContentSequence
            }
        ]);
    }
}
