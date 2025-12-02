/**
 * Builds a DICOM SR ContentSequence block for geometric measurements
 * that share the same structure across tools (Circle, Ellipse, Polyline, etc.)
 */
export default class Tid320ContentItem {
    constructor({
        graphicType,
        graphicData,
        use3DSpatialCoordinates = false,
        referencedSOPSequence,
        referencedFrameOfReferenceUID
    }) {
        this.graphicType = graphicType;
        this.graphicData = graphicData;
        this.use3DSpatialCoordinates = use3DSpatialCoordinates;
        this.referencedSOPSequence = referencedSOPSequence;
        this.referencedFrameOfReferenceUID = referencedFrameOfReferenceUID;
    }

    contentItem() {
        const content = {
            RelationshipType: "INFERRED FROM",
            ValueType: this.use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
            GraphicType: this.graphicType,
            GraphicData: this.graphicData
        };

        if (this.use3DSpatialCoordinates) {
            content.ReferencedFrameOfReferenceUID =
                this.referencedFrameOfReferenceUID;
        } else {
            content.ContentSequence = {
                RelationshipType: "SELECTED FROM",
                ValueType: "IMAGE",
                ReferencedSOPSequence: this.referencedSOPSequence
            };
        }

        return content;
    }
}
