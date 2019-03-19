import { DicomMetaDictionary } from "../../DicomMetaDictionary.js";
import TID300Measurement from "./TID300Measurement.js";

export default class Point extends TID300Measurement {
    // Note: the last point should be equal to the first point to indicate that the point is closed.
    constructor({
        points,
        lengths,
        ReferencedSOPSequence,
        use3DSpatialCoordinates = false
    }) {
        super();

        this.points = points;
        this.lengths = lengths; // Array of lengths between each point
        this.ReferencedSOPSequence = ReferencedSOPSequence;
        this.use3DSpatialCoordinates = use3DSpatialCoordinates;
    }

    contentItem() {
        const {
            points,
            lengths,
            ReferencedSOPSequence,
            use3DSpatialCoordinates = false
        } = this;

        // Combine all lengths to save the perimeter
        // @ToDO The permiter has to be implemented
        // const reducer = (accumulator, currentValue) => accumulator + currentValue;
        // const perimeter = lengths.reduce(reducer);
        const perimeter = {};
        const GraphicData = points[0];

        // TODO: Add Mean and STDev value of (modality?) pixels

        return [
            {
                RelationshipType: "HAS OBS CONTEXT",
                ValueType: "TEXT",
                ConceptNameCodeSequence: {
                    CodeValue: "112039",
                    CodingSchemeDesignator: "DCM",
                    CodeMeaning: "Tracking Identifier"
                },
                TextValue: "web annotation"
            },
            {
                RelationshipType: "HAS OBS CONTEXT",
                ValueType: "UIDREF",
                ConceptNameCodeSequence: {
                    CodeValue: "112040",
                    CodingSchemeDesignator: "DCM",
                    CodeMeaning: "Tracking Unique Identifier"
                },
                UID: DicomMetaDictionary.uid()
            },
            {
                RelationshipType: "CONTAINS",
                ValueType: "CODE",
                ConceptNameCodeSequence: {
                    CodeValue: "121071",
                    CodingSchemeDesignator: "DCM",
                    CodeMeaning: "Finding"
                },
                ConceptCodeSequence: {
                    CodeValue: "SAMPLEFINDING",
                    CodingSchemeDesignator: "99dcmjs",
                    CodeMeaning: "Sample Finding"
                }
            },
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "G-A197",
                    CodingSchemeDesignator: "SRT",
                    CodeMeaning: "Perimeter" // TODO: Look this up from a Code Meaning dictionary
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: {
                        CodeValue: "mm",
                        CodingSchemeDesignator: "UCUM",
                        CodingSchemeVersion: "1.4",
                        CodeMeaning: "millimeter"
                    },
                    NumericValue: perimeter
                },
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
                    GraphicType: "POINT",
                    GraphicData,
                    ContentSequence: use3DSpatialCoordinates
                        ? undefined
                        : {
                              RelationshipType: "SELECTED FROM",
                              ValueType: "IMAGE",
                              ReferencedSOPSequence
                          }
                }
            },
            {
                // TODO: This feels weird to repeat the GraphicData
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "G-A166",
                    CodingSchemeDesignator: "SRT",
                    CodeMeaning: "Area" // TODO: Look this up from a Code Meaning dictionary
                },
                MeasuredValueSequence: {
                    MeasurementUnitsCodeSequence: {
                        CodeValue: "mm2",
                        CodingSchemeDesignator: "UCUM",
                        CodingSchemeVersion: "1.4",
                        CodeMeaning: "SquareMilliMeter"
                    },
                    NumericValue: perimeter
                },
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
                    GraphicType: "POINT",
                    GraphicData,
                    ContentSequence: use3DSpatialCoordinates
                        ? undefined
                        : {
                              RelationshipType: "SELECTED FROM",
                              ValueType: "IMAGE",
                              ReferencedSOPSequence
                          }
                }
            }
        ];
    }
}
