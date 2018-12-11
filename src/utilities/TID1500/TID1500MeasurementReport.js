export default class TID1500MeasurementReport {
    constructor(TID1501MeasurementGroups) {
        this.TID1501MeasurementGroups = TID1501MeasurementGroups
    }

    validate() {

    }

    contentItem(derivationSourceDataset, options={}) {
        // Add the Measurement Groups to the Measurement Report
        let ContentSequence = [];
        this.TID1501MeasurementGroups.forEach(child => {
          ContentSequence = ContentSequence.concat(child.contentItem());
        });

        // For each measurement that is referenced, add a link to the
        // Image Library Group and the Current Requested Procedure Evidence
        // with the proper ReferencedSOPSequence
        let ImageLibraryContentSequence = [];
        let CurrentRequestedProcedureEvidenceSequence = [];
        this.TID1501MeasurementGroups.forEach(measurementGroup => {
          measurementGroup.TID300Measurements.forEach(measurement => {
            ImageLibraryContentSequence.push({
              RelationshipType: 'CONTAINS',
              ValueType: 'IMAGE',
              ReferencedSOPSequence: measurement.ReferencedSOPSequence,
            });

            CurrentRequestedProcedureEvidenceSequence.push({
              StudyInstanceUID: derivationSourceDataset.StudyInstanceUID,
              ReferencedSeriesSequence: {
                SeriesInstanceUID: derivationSourceDataset.SeriesInstanceUID,
                ReferencedSOPSequence: measurement.ReferencedSOPSequence,                
              }
            })
          });
        });

        return {
            ConceptNameCodeSequence: {
                CodeValue: '126000',
                CodingSchemeDesignator: 'DCM',
                CodeMeaning: 'Imaging Measurement Report'
            },
            ContinuityOfContent: 'SEPARATE',
            PerformedProcedureCodeSequence: [],
            CompletionFlag: 'COMPLETE',
            VerificationFlag: 'UNVERIFIED',
            ReferencedPerformedProcedureStepSequence: [],
            InstanceNumber: 1,
            CurrentRequestedProcedureEvidenceSequence,
            CodingSchemeIdentificationSequence: {
                CodingSchemeDesignator: "99dcmjs",
                CodingSchemeName: "Codes used for dcmjs",
                CodingSchemeVersion: "0",
                CodingSchemeResponsibleOrganization: "https://github.com/dcmjs-org/dcmjs"
            },
            ContentTemplateSequence: {
                MappingResource: 'DCMR',
                TemplateIdentifier: '1500'
            },
            ContentSequence: [{
                RelationshipType: 'HAS CONCEPT MOD',
                ValueType: 'CODE',
                ConceptNameCodeSequence: {
                    CodeValue: '121049',
                    CodingSchemeDesignator: 'DCM',
                    CodeMeaning: 'Language of Content Item and Descendants',
                },
                ConceptCodeSequence: {
                    CodeValue: 'eng',
                    CodingSchemeDesignator: 'RFC3066',
                    CodeMeaning: 'English',
                },
                ContentSequence: {
                    RelationshipType: 'HAS CONCEPT MOD',
                    ValueType: 'CODE',
                    ConceptNameCodeSequence: {
                        CodeValue: '121046',
                        CodingSchemeDesignator: 'DCM',
                        CodeMeaning: 'Country of Language',
                    },
                    ConceptCodeSequence: {
                        CodeValue: 'US',
                        CodingSchemeDesignator: 'ISO3166_1',
                        CodeMeaning: 'United States',
                    }
                }
            }, {
                RelationshipType: 'HAS OBS CONTEXT',
                ValueType: 'PNAME',
                ConceptNameCodeSequence: {
                    CodeValue: '121008',
                    CodingSchemeDesignator: 'DCM',
                    CodeMeaning: 'Person Observer Name',
                },
                PersonName: options.PersonName || 'unknown^unknown'
            }, {
                RelationshipType: 'HAS CONCEPT MOD',
                ValueType: 'CODE',
                ConceptNameCodeSequence: {
                    CodeValue: '121058',
                    CodingSchemeDesignator: 'DCM',
                    CodeMeaning: 'Procedure reported'
                },
                ConceptCodeSequence: {
                    CodeValue: '1',
                    CodingSchemeDesignator: '99dcmjs',
                    CodeMeaning: 'Unknown procedure'
                },
            }, {
                RelationshipType: 'CONTAINS',
                ValueType: 'CONTAINER',
                ConceptNameCodeSequence: {
                    CodeValue: '111028',
                    CodingSchemeDesignator: 'DCM',
                    CodeMeaning: 'Image Library',
                },
                ContinuityOfContent: 'SEPARATE',
                ContentSequence: {
                  RelationshipType: 'CONTAINS',
                  ValueType: 'CONTAINER',
                  ConceptNameCodeSequence: {
                    CodeValue: '126200',
                    CodingSchemeDesignator: 'DCM',
                    CodeMeaning: 'Image Library Group',
                  },
                  ContinuityOfContent: 'SEPARATE',
                  ContentSequence: ImageLibraryContentSequence,
                }
            }, {
                RelationshipType: 'CONTAINS',
                ValueType: 'CONTAINER',
                ConceptNameCodeSequence: {
                    CodeValue: '126010',
                    CodingSchemeDesignator: 'DCM',
                    CodeMeaning: 'Imaging Measurements', // TODO: would be nice to abstract the code sequences (in a dictionary? a service?)
                },
                ContinuityOfContent: 'SEPARATE',
                ContentSequence: {
                    RelationshipType: 'CONTAINS',
                    ValueType: 'CONTAINER',
                    ConceptNameCodeSequence: {
                        CodeValue: '125007',
                        CodingSchemeDesignator: 'DCM',
                        CodeMeaning: 'Measurement Group',
                    },
                    ContinuityOfContent: 'SEPARATE',
                    ContentSequence,
                },
            }]
        };
    };
}
