import TID300Measurement from "./TID300Measurement.js";
import unit2CodingValue from "./unit2CodingValue.js";
import TID320ContentItem from "./TID320ContentItem.js";
import MeasurementBuilder from "../MeasurementBuilder.js";

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
            ReferencedFrameOfReferenceUID,
            annotationIndex
        } = this.props;

        const GraphicData = this.flattenPoints({
            points,
            use3DSpatialCoordinates
        });

        const measurementConfigs = [
            {
                value: max,
                unit: modalityUnit,
                builder: MeasurementBuilder.createMaxMeasurement
            },
            {
                value: min,
                unit: modalityUnit,
                builder: MeasurementBuilder.createMinMeasurement
            },
            {
                value: mean,
                unit: modalityUnit,
                builder: MeasurementBuilder.createMeanMeasurement
            },
            {
                value: stdDev,
                unit: modalityUnit,
                builder: MeasurementBuilder.createStdDevMeasurement
            }
        ];

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
                ContentSequence: new TID320ContentItem({
                    graphicType: "ELLIPSE",
                    graphicData: GraphicData,
                    use3DSpatialCoordinates,
                    referencedSOPSequence: ReferencedSOPSequence,
                    referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
                }).contentItem()
            },
            ...measurementConfigs
                .filter(config => config.value !== undefined)
                .map(config =>
                    config.builder(config.value, config.unit, annotationIndex)
                )
        ];

        return this.getMeasurement(measurements);
    }
}
