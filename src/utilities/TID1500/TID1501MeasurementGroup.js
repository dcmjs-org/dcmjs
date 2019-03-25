export default class TID1501MeasurementGroup {
    constructor(TID300MeasurementContentSequences) {
        this.TID300MeasurementContentSequences = TID300MeasurementContentSequences;
    }

    generateContentSequence() {
        const { TID300MeasurementContentSequences } = this;

        const contentSequence = TID300MeasurementContentSequences.map(
            TID300MeasurementContentSequence => {
                return {
                    RelationshipType: "CONTAINS",
                    ValueType: "CONTAINER",
                    ConceptNameCodeSequence: {
                        CodeValue: "125007",
                        CodingSchemeDesignator: "DCM",
                        CodeMeaning: "Measurement Group"
                    },
                    ContinuityOfContent: "SEPARATE",
                    ContentSequence: TID300MeasurementContentSequence
                };
            }
        );

        return contentSequence;
    }
}
