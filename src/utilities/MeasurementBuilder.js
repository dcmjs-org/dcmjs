import unit2CodingValue from "./TID300/unit2CodingValue";

/**
 * Utility class for constructing DICOM SR Numeric (NUM) measurement items
 * associated with a spatial coordinate (SCOORD) annotation.
 *
 * Each measurement produced by this builder includes:
 *  - A NUM content item describing the measurement value
 *  - A MeasuredValueSequence with its unit encoded in UCUM or another scheme
 *  - A ContentSequence containing an INFERRED FROM reference linking the
 *    measurement back to the SCOORD item using ReferencedContentItemIdentifier.
 *
 * This ensures that all derived measurements correctly reference the
 * annotation from which they were computed.
 */
class MeasurementBuilder {
    /**
     * Creates a NUM (Numeric Measurement) content item for a DICOM SR.
     *
     * @param {string} codeValue - Code value representing the type of measurement.
     * @param {string} codingScheme - Coding scheme designator (e.g., "SCT", "DCM").
     * @param {string} codeMeaning - Human-readable meaning of the measurement code.
     * @param {number|string} value - The numeric measurement value.
     * @param {Object} unit - Unit definition object (UCUM or other coding scheme).
     * @param {number} annotationIndex - Index used to populate ReferencedContentItemIdentifier,
     *                                   ensuring the NUM item correctly references its SCOORD.
     *
     * @returns {Object} DICOM SR content item representing a numeric measurement.
     */

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
            "42798000",
            "SCT",
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
