import { DicomMetaDictionary } from "../../DicomMetaDictionary.js";
import TID300Measurement from "./TID300Measurement.js";

export default class Length extends TID300Measurement {
    constructor({ point1, point2, distance, ReferencedSOPSequence }) {
        super();

        this.point1 = point1;
        this.point2 = point2;
        this.distance = distance;
        this.ReferencedSOPSequence = ReferencedSOPSequence;
    }

    contentItem() {
        const { point1, point2, distance, ReferencedSOPSequence } = this;

        return [
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "G-D7FE",
                    CodingSchemeDesignator: "SRT",
                    CodeMeaning: "Length"
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: {
                        CodeValue: "mm",
                        CodingSchemeDesignator: "UCUM",
                        CodingSchemeVersion: "1.4",
                        CodeMeaning: "millimeter"
                    },
                    NumericValue: distance
                },
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: "SCOORD",
                    GraphicType: "POLYLINE",
                    GraphicData: [point1.x, point1.y, point2.x, point2.y],
                    ContentSequence: {
                        RelationshipType: "SELECTED FROM",
                        ValueType: "IMAGE",
                        ReferencedSOPSequence
                    }
                }
            }
        ];
    }
}
