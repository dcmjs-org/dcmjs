import TID300Measurement from "./TID300Measurement.js";
import TID320ContentItem from "./TID320ContentItem.js";

export default class OpenPolyline extends TID300Measurement {
    getPoints() {
        throw new Error("getPoints() must be implemented by subclass");
    }

    getConceptNameCodeSequence() {
        throw new Error("getConceptNameCodeSequence() must be implemented");
    }

    getMeasuredValueSequence() {
        return null;
    }

    buildGraphicContent() {
        const {
            use3DSpatialCoordinates = false,
            ReferencedSOPSequence,
            ReferencedFrameOfReferenceUID
        } = this.props;

        const GraphicData = this.flattenPoints({
            points: this.getPoints(),
            use3DSpatialCoordinates
        });

        return new TID320ContentItem({
            graphicType: "POLYLINE",
            graphicData: GraphicData,
            use3DSpatialCoordinates,
            referencedSOPSequence: ReferencedSOPSequence,
            referencedFrameOfReferenceUID: ReferencedFrameOfReferenceUID
        }).contentItem();
    }

    contentItem() {
        const concept = this.getConceptNameCodeSequence();
        const measuredValue = this.getMeasuredValueSequence();

        return this.getMeasurement([
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: concept,
                MeasuredValueSequence: measuredValue,
                ContentSequence: this.buildGraphicContent()
            }
        ]);
    }
}
