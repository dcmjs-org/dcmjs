import { DicomMetaDictionary } from "../../DicomMetaDictionary";

export default class TID300Measurement {
    constructor() {}

    generateContentSequence() {
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
            }
            /*{
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
      }*/
        ];
    }
}
