import TID300Measurement from "./TID300Measurement.js";
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
            ReferencedFrameOfReferenceUID
        } = this.props;

        const GraphicData = this.flattenPoints({
            points,
            use3DSpatialCoordinates
        });

        // Create group-level SCOORD
        const scoordItem = {
            RelationshipType: "CONTAINS",
            ValueType: this.use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
            ConceptNameCodeSequence: {
                CodeValue: "C00A3DD7",
                CodingSchemeDesignator: "DCM",
                CodeMeaning: "ROI"
            },
            GraphicType: "ELLIPSE",
            GraphicData,
            ContentSequence: {
                RelationshipType: "SELECTED FROM",
                ValueType: "IMAGE",
                ReferencedSOPSequence
            }
        };

        const measurementConfigs = [
            {
                value: area,
                unit: areaUnit,
                builder: MeasurementBuilder.createAreaMeasurement
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

        const measurements = [
            measurementConfigs
                .filter(config => config.value !== undefined)
                .map(config => config.builder(config.value, config.unit))
        ];
        console.log([scoordItem, ...measurements]);

        return [scoordItem, ...measurements];
    }
}
