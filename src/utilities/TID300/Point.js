import TID300Measurement from "./TID300Measurement.js";

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
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
                    GraphicType: "POINT",
                    GraphicData,
                    ReferencedFrameOfReferenceUID: use3DSpatialCoordinates
                        ? ReferencedFrameOfReferenceUID
                        : undefined,
                    ContentSequence: use3DSpatialCoordinates
                        ? undefined
                        : {
                              RelationshipType: "SELECTED FROM",
                              ValueType: "IMAGE",
                              ReferencedSOPSequence
                          }
                }
            }
        ]);
    }
}
