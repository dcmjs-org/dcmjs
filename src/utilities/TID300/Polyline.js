import TID300Measurement from "./TID300Measurement";
import unit2CodingValue from "./unit2CodingValue";
import buildContentSequence from "./buildContentSequence.js";

export default class Polyline extends TID300Measurement {
    contentItem() {
        const {
            points,
            area,
            areaUnit = "mm2",
            ReferencedSOPSequence,
            use3DSpatialCoordinates = false,
            perimeter,
            unit = "mm",
            modalityUnit,
            min,
            max,
            mean,
            stdDev,
            ReferencedFrameOfReferenceUID
        } = this.props;

        const GraphicData = this.flattenPoints({
            points,
            use3DSpatialCoordinates
        });

        const graphicContentSequence = buildContentSequence({
            graphicType: "POLYLINE",
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
                    CodeValue: "131191004",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Perimeter"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(unit),
                    NumericValue: perimeter
                },
                ContentSequence: graphicContentSequence
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
                ContentSequence: graphicContentSequence
            },
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "56851009",
                    CodingSchemeDesignator: "SRT",
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
                ContentSequence: graphicContentSequence
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
