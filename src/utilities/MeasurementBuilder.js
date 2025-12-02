import unit2CodingValue from "./TID300/unit2CodingValue";

class MeasurementBuilder {
    static createNumericMeasurement(
        codeValue,
        codingScheme,
        codeMeaning,
        value,
        unit,
        annotationIndex
    ) {
        return {
            RelationshipType: "CONTAINS",
            ValueType: "NUM",
            ConceptNameCodeSequence: {
                CodeValue: codeValue,
                CodingSchemeDesignator: codingScheme,
                CodeMeaning: codeMeaning
            },
            MeasuredValueSequence: {
                MeasurementUnitsCodeSequence: unit2CodingValue(unit),
                NumericValue: value
            },
            ContentSequence: {
                RelationshipType: "INFERRED FROM",
                ReferencedContentItemIdentifier: [1, 1, annotationIndex]
            }
        };
    }

    static createAreaMeasurement(area, areaUnit, annotationIndex) {
        return MeasurementBuilder.createNumericMeasurement(
            "G-A166",
            "SRT",
            "Area",
            area,
            areaUnit,
            annotationIndex
        );
    }

    static createRadiusMeasurement(radius, radiusUnit, annotationIndex) {
        return MeasurementBuilder.createNumericMeasurement(
            "131190003",
            "SCT",
            "Radius",
            radius,
            radiusUnit,
            annotationIndex
        );
    }

    static createMaxMeasurement(max, modalityUnit, annotationIndex) {
        return MeasurementBuilder.createNumericMeasurement(
            "56851009",
            "SCT",
            "Maximum",
            max,
            modalityUnit,
            annotationIndex
        );
    }

    static createMinMeasurement(min, modalityUnit, annotationIndex) {
        return MeasurementBuilder.createNumericMeasurement(
            "255605001",
            "SCT",
            "Minimum",
            min,
            modalityUnit,
            annotationIndex
        );
    }

    static createMeanMeasurement(mean, modalityUnit, annotationIndex) {
        return MeasurementBuilder.createNumericMeasurement(
            "373098007",
            "SCT",
            "Mean",
            mean,
            modalityUnit,
            annotationIndex
        );
    }

    static createStdDevMeasurement(stdDev, modalityUnit, annotationIndex) {
        return MeasurementBuilder.createNumericMeasurement(
            "386136009",
            "SCT",
            "Standard Deviation",
            stdDev,
            modalityUnit,
            annotationIndex
        );
    }
}

export default MeasurementBuilder;
