import TID300Measurement from "./TID300Measurement.js";
import TID320ContentItem from "./TID320ContentItem.js";
import MeasurementBuilder from "../MeasurementBuilder.js";

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

        const measurementConfigs = [
            {
                value: perimeter,
                unit: unit,
                builder: MeasurementBuilder.createPerimeterMeasurement
            },
            {
                value: area,
                unit: areaUnit,
                builder: MeasurementBuilder.createAreaMeasurement
            },
            {
                value: radius,
                unit: radiusUnit,
                builder: MeasurementBuilder.createRadiusMeasurement
            },
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

        const scoordContentItem = new TID320ContentItem({
            graphicType: "CIRCLE",
            graphicData: GraphicData,
            use3DSpatialCoordinates,
            referencedSOPSequence: ReferencedSOPSequence,
            referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
        }).contentItem();

        const measurements = measurementConfigs
            .filter(config => config.value !== undefined)
            .map((config, index) =>
                config.builder(config.value, config.unit, {
                    scoordContentItem: index === 0 ? scoordContentItem : null
                })
            );

        return this.getMeasurement(measurements);
    }
}
