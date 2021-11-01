import TID300Measurement from "./TID300Measurement.js";

export default class Angle extends TID300Measurement {
    contentItem() {
        const {
            point1,
            point2,
            point3,
            rAngle,
            ReferencedSOPSequence
        } = this.props;

        return this.getMeasurement([
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "4000022",
                    CodingSchemeDesignator: "99PDL-rad",
                    CodeMeaning: "Angle"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: {
                        CodeValue: "deg",
                        CodingSchemeDesignator: "UCUM",
                        CodingSchemeVersion: "1.4",
                        CodeMeaning: "degree"
                    },
                    NumericValue: rAngle
                },
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: "SCOORD",
                    GraphicType: "POLYLINE",
                    GraphicData: [
                        point1.x,
                        point1.y,
                        point2.x,
                        point2.y,
                        point3.x,
                        point3.y
                    ],
                    ContentSequence: {
                        RelationshipType: "SELECTED FROM",
                        ValueType: "IMAGE",
                        ReferencedSOPSequence
                    }
                }
            }
        ]);
    }
}
