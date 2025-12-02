import TID300Measurement from "./TID300Measurement.js";
import Tid320ContentItem from "./Tid320ContentItem.js";

export default class CobbAngle extends TID300Measurement {
    contentItem() {
        const {
            point1,
            point2,
            point3,
            point4,
            rAngle,
            use3DSpatialCoordinates,
            ReferencedSOPSequence,
            ReferencedFrameOfReferenceUID
        } = this.props;

        const GraphicData = this.flattenPoints({
            points: [point1, point2, point3, point4],
            use3DSpatialCoordinates
        });

        const graphicContentSequence = new Tid320ContentItem({
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
                    CodeValue: "285285000",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Cobb angle"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: {
                        CodeValue: "deg",
                        CodingSchemeDesignator: "UCUM",
                        CodingSchemeVersion: "1.4",
                        CodeMeaning: "\u00B0"
                    },
                    NumericValue: rAngle
                },
                ContentSequence: graphicContentSequence
            }
        ]);
    }
}
