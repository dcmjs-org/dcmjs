import TID300Measurement from "./TID300Measurement.js";
import unit2CodingValue from "./unit2CodingValue.js";
import buildContentSequence from "./buildContentSequence.js";

export default class Ellipse extends TID300Measurement {
    contentItem() {
        const {
            points,
            use3DSpatialCoordinates = false,
            ReferencedSOPSequence,
            area,
            areaUnit,
            max,
            min,
            mean,
            stdDev,
            modalityUnit,
            ReferencedFrameOfReferenceUID
        } = this.props;

        const GraphicData = this.flattenPoints({
            points,
            use3DSpatialCoordinates
        });

        const graphicContentSequence = buildContentSequence({
            graphicType: "ELLIPSE",
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
                    CodeValue: "G-D7FE",
                    CodingSchemeDesignator: "SRT",
                    CodeMeaning: "AREA"
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
