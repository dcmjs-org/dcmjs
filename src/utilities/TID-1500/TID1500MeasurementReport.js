export default class TID1500MeasurementReport() {
    constructor(TID1501MeasurementGroups) {
        this.TID1501MeasurementGroups = TID1501MeasurementGroups
    }

    contentItem() {
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
            CurrentRequestedProcedureEvidenceSequence: {
                StudyInstanceUID: dataset.StudyInstanceUID,
                ReferencedSeriesSequence: {
                    SeriesInstanceUID: dataset.SeriesInstanceUID,
                    ReferencedSOPSequence: {
                        ReferencedSOPClassUID: derivationSourceDataset.SOPClassUID,
                        ReferencedSOPInstanceUID: derivationSourceDataset.SOPInstanceUID
                    },
                },
            },
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
                PersonName: 'user^web' // TODO: these can be options argument for constructor
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
                    ContentSequence: {
                        RelationshipType: 'CONTAINS',
                        ValueType: 'IMAGE',
                        ReferencedSOPSequence: {
                            // TODO: this should refer to the UIDs extracted from the toolState / instance info
                            ReferencedSOPClassUID: dataset.SOPClassUID,
                            ReferencedSOPInstanceUID: dataset.SOPInstanceUID,
                        },
                    },
                },
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
                    ContentSequence: this.TID1501MeasurementGroups,
                },
            }]
        };
    };
}