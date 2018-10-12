export default class TID1501MeasurementGroup {
	constructor(TID300Measurements) {
		this.TID300Measurements = TID300Measurements
	}

	contentItem() {
	  const { TID300Measurements } = this;

		let contentItem = [
        {
            RelationshipType: 'HAS OBS CONTEXT',
            ValueType: 'TEXT',
            ConceptNameCodeSequence: {
                CodeValue: '112039',
                CodingSchemeDesignator: 'DCM',
                CodeMeaning: 'Tracking Identifier',
            },
            TextValue: 'web annotation',
        },
        {
            RelationshipType: 'HAS OBS CONTEXT',
            ValueType: 'UIDREF',
            ConceptNameCodeSequence: {
                CodeValue: '112040',
                CodingSchemeDesignator: 'DCM',
                CodeMeaning: 'Tracking Unique Identifier',
            },
            UID: dcmjs.data.DicomMetaDictionary.uid(),
        },
        {
            RelationshipType: 'CONTAINS',
            ValueType: 'CODE',
            ConceptNameCodeSequence: {
                CodeValue: '121071',
                CodingSchemeDesignator: 'DCM',
                CodeMeaning: 'Finding',
            },
            ConceptCodeSequence: {
                CodeValue: 'SAMPLEFINDING',
                CodingSchemeDesignator: '99dcmjs',
                CodeMeaning: 'Sample Finding',
            },
        },
    ];

		let measurements = [];
    TID300Measurements.forEach(TID300Measurement => {
      measurements = measurements.concat(TID300Measurement.contentItem())
    });

    contentItem = contentItem.concat(measurements);

    return contentItem;
	}
}
