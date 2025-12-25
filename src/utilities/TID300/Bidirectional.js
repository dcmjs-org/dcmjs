import TID300Measurement from "./TID300Measurement.js";
import unit2CodingValue from "./unit2CodingValue.js";
import TID320ContentItem from "./TID320ContentItem.js";

export default class Bidirectional extends TID300Measurement {
    contentItem() {
        const {
            longAxis,
            shortAxis,
            longAxisLength,
            shortAxisLength,
            unit,
            use3DSpatialCoordinates = false,
            ReferencedSOPSequence,
            ReferencedFrameOfReferenceUID
        } = this.props;

        const longAxisGraphicData = this.flattenPoints({
            points: [longAxis.point1, longAxis.point2],
            use3DSpatialCoordinates
        });
        const shortAxisGraphicData = this.flattenPoints({
            points: [shortAxis.point1, shortAxis.point2],
            use3DSpatialCoordinates
        });

        const longAxisContentSequence = new TID320ContentItem({
            graphicType: "POLYLINE",
            graphicData: longAxisGraphicData,
            use3DSpatialCoordinates,
            referencedSOPSequence: ReferencedSOPSequence,
            referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
        }).contentItem();

        const shortAxisContentSequence = new TID320ContentItem({
            graphicType: "POLYLINE",
            graphicData: shortAxisGraphicData,
            use3DSpatialCoordinates,
            referencedSOPSequence: ReferencedSOPSequence,
            referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
        }).contentItem();

        return this.getMeasurement([
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "103339001",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Long Axis"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(unit),
                    NumericValue: longAxisLength
                },
                ContentSequence: longAxisContentSequence
            },
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "103340004",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Short Axis"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: unit2CodingValue(unit),
                    NumericValue: shortAxisLength
                },
                ContentSequence: shortAxisContentSequence
            }
        ]);
    }
}
