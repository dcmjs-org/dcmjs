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

        const GraphicData = this.flattenPoints({
            // Allow storing another point as part of an indicator showing a single point
            points: points.slice(0, 2),
            use3DSpatialCoordinates
        });

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
                //MeasuredValueSequence: ,
                ContentSequence: graphicContentSequence
            }
        ]);
    }
}
