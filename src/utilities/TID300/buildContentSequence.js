/**
 * Builds a DICOM SR ContentSequence block for geometric measurements
 * that share the same structure across tools (Circle, Ellipse, Polyline, etc.)
 */
export default function buildContentSequence({
    graphicType,
    graphicData,
    use3DSpatialCoordinates = false,
    referencedSOPSequence,
    referencedFrameOfReferenceUID
}) {
    const content = {
        RelationshipType: "INFERRED FROM",
        ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
        GraphicType: graphicType,
        GraphicData: graphicData
    };

    if (use3DSpatialCoordinates) {
        content.ReferencedFrameOfReferenceUID = referencedFrameOfReferenceUID;
    } else {
        content.ContentSequence = {
            RelationshipType: "SELECTED FROM",
            ValueType: "IMAGE",
            ReferencedSOPSequence: referencedSOPSequence
        };
    }

    return content;
}
