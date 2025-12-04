import TID300Measurement from "./TID300Measurement.js";
import unit2CodingValue from "./unit2CodingValue.js";
import TID320ContentItem from "./TID320ContentItem.js";

export default class Calibration extends TID300Measurement {
    contentItem() {
        const {
            point1,
            point2,
            unit = "mm",
            use3DSpatialCoordinates = false,
            distance,
            ReferencedSOPSequence,
            ReferencedFrameOfReferenceUID
        } = this.props;

        const GraphicData = this.flattenPoints({
            points: [point1, point2],
            use3DSpatialCoordinates
        });

        const graphicContentSequence = new TID320ContentItem({
            graphicType: "POLYLINE",
            graphicData: GraphicData,
            use3DSpatialCoordinates,
            referencedSOPSequence: ReferencedSOPSequence,
            referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
        }).contentItem();

        return this.getMeasurement([
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "102304005",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Calibration Ruler"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(unit),
                    NumericValue: distance
                },
                ContentSequence: graphicContentSequence
            }
        ]);
    }
}
