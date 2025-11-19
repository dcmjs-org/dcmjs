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

        const measurements = [
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
                ContentSequence: buildContentSequence({
                    graphicType: "ELLIPSE",
                    graphicData: GraphicData,
                    use3DSpatialCoordinates,
                    referencedSOPSequence: ReferencedSOPSequence,
                    referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
                })
            }
        ];

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
                    graphicType: "ELLIPSE",
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
                    graphicType: "ELLIPSE",
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
                    graphicType: "ELLIPSE",
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
                    graphicType: "ELLIPSE",
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
