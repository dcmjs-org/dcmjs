import TID300Measurement from "./TID300Measurement.js";
import TID320ContentItem from "./TID320ContentItem.js";

export default class Point extends TID300Measurement {
    contentItem() {
        const {
            points,
            ReferencedSOPSequence,
            use3DSpatialCoordinates = false,
            ReferencedFrameOfReferenceUID
        } = this.props;

        // Point must contain exactly one coordinate
        const point = points[0];

        const GraphicData = use3DSpatialCoordinates
            ? [point.x, point.y, point.z]
            : [point.x, point.y];

        const graphicContentSequence = new TID320ContentItem({
            graphicType: "POINT",
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
                    CodeValue: "111010",
                    CodingSchemeDesignator: "DCM",
                    CodeMeaning: "Center"
                },

                // MeasuredValueSequence is required for NUM items per TID 300/1501
                MeasuredValueSequence: {
                    NumericValue: 0,
                    MeasurementUnitsCodeSequence: {
                        CodeValue: "1",
                        CodingSchemeDesignator: "UCUM",
                        CodeMeaning: "no units"
                    }
                },
                ContentSequence: graphicContentSequence
            }
        ]);
    }
}
