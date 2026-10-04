import { DicomMetaDictionary } from "./DicomMetaDictionary.js";
import { Tag } from "./Tag.js";
import { ValueRepresentation } from "./ValueRepresentation.js";

// Every entry below must be a real dictionary keyword
// (DicomMetaDictionary.nameMap): cleanTags silently skips names that do not
// resolve, so a misspelled entry means the data it was meant to scrub is
// left in place (issue #345). Retired attributes use the dictionary's
// RETIRED_ keyword prefix. All 103 previously non-resolving names were
// mapped to their intended keywords; none had to be removed.
var tagNamesToEmpty = [
    // please override these in specificReplaceDefaults to have useful values
    "PatientID",
    "PatientName",

    // 0/3: those that appear missing in CTP
    "SeriesDate",
    "AccessionNumber",
    // (valuable, but sometimes manually filled)
    "SeriesDescription",
    // cat 1/3: CTP: set to empty explicitely using @empty
    "StudyTime",
    "ContentTime",
    "ReferringPhysicianName",
    "PatientBirthDate",
    "PatientSex",
    "ClinicalTrialSiteID",
    "ClinicalTrialSiteName",
    "ClinicalTrialSubjectID",
    "ClinicalTrialSubjectReadingID",
    "ClinicalTrialTimePointID",
    "ClinicalTrialTimePointDescription",
    "ContrastBolusAgent",
    "StudyID",
    // cat 2/3: CTP: set to increment dates
    "InstanceCreationDate",
    "StudyDate",
    "ContentDate",
    "DateOfSecondaryCapture",
    "DateOfLastCalibration",
    "DateOfLastDetectorCalibration",
    "FrameAcquisitionDateTime",
    "FrameReferenceDateTime",
    "RETIRED_StudyVerifiedDate",
    "RETIRED_StudyReadDate",
    "RETIRED_ScheduledStudyStartDate",
    "RETIRED_ScheduledStudyStopDate",
    "RETIRED_StudyArrivalDate",
    "RETIRED_StudyCompletionDate",
    "RETIRED_ScheduledAdmissionDate",
    "RETIRED_ScheduledDischargeDate",
    "RETIRED_DischargeDate",
    "ScheduledProcedureStepStartDate",
    "ScheduledProcedureStepEndDate",
    "PerformedProcedureStepStartDate",
    "PerformedProcedureStepEndDate",
    "IssueDateOfImagingServiceRequest",
    "VerificationDateTime",
    "ObservationDateTime",
    "DateTime",
    "Date",
    "ReferencedDateTime",
    // cat 3/3: CTP: set to remove using @remove
    "AcquisitionDate",
    "RETIRED_OverlayDate",
    "RETIRED_CurveDate",
    "AcquisitionDateTime",
    "SeriesTime",
    "AcquisitionTime",
    "RETIRED_OverlayTime",
    "RETIRED_CurveTime",
    "InstitutionName",
    "InstitutionAddress",
    "ReferringPhysicianAddress",
    "ReferringPhysicianTelephoneNumbers",
    "ReferringPhysicianIdentificationSequence",
    "TimezoneOffsetFromUTC",
    "StationName",
    "StudyDescription",
    "InstitutionalDepartmentName",
    "PhysiciansOfRecord",
    "PhysiciansOfRecordIdentificationSequence",
    "PerformingPhysicianName",
    "PerformingPhysicianIdentificationSequence",
    "NameOfPhysiciansReadingStudy",
    "PhysiciansReadingStudyIdentificationSequence",
    "OperatorsName",
    "OperatorIdentificationSequence",
    "AdmittingDiagnosesDescription",
    "AdmittingDiagnosesCodeSequence",
    "ReferencedStudySequence",
    "ReferencedPerformedProcedureStepSequence",
    "ReferencedPatientSequence",
    "ReferencedImageSequence",
    "DerivationDescription",
    "SourceImageSequence",
    "RETIRED_IdentifyingComments",
    "IssuerOfPatientID",
    "PatientBirthTime",
    "PatientInsurancePlanCodeSequence",
    "PatientPrimaryLanguageCodeSequence",
    "PatientPrimaryLanguageModifierCodeSequence",
    "OtherPatientIDs",
    "OtherPatientNames",
    "OtherPatientIDsSequence",
    "PatientBirthName",
    "PatientAge",
    "PatientSize",
    "PatientWeight",
    "PatientAddress",
    "RETIRED_InsurancePlanIdentification",
    "PatientMotherBirthName",
    "MilitaryRank",
    "BranchOfService",
    "MedicalRecordLocator",
    "MedicalAlerts",
    "Allergies",
    "CountryOfResidence",
    "RegionOfResidence",
    "PatientTelephoneNumbers",
    "EthnicGroup",
    "Occupation",
    "SmokingStatus",
    "AdditionalPatientHistory",
    "PregnancyStatus",
    "LastMenstrualDate",
    "PatientReligiousPreference",
    "PatientSexNeutered",
    "ResponsiblePerson",
    "ResponsibleOrganization",
    "PatientComments",
    "DeviceSerialNumber",
    "PlateID",
    "GeneratorID",
    "CassetteID",
    "GantryID",
    // we keep - should be SoftwareVersions anyway
    // "SoftwareVersion",
    "ProtocolName",
    "AcquisitionDeviceProcessingDescription",
    "RETIRED_AcquisitionComments",
    "DetectorID",
    "AcquisitionProtocolDescription",
    "ContributionDescription",
    "RETIRED_ModifyingDeviceID",
    "RETIRED_ModifyingDeviceManufacturer",
    "RETIRED_ModifiedImageDescription",
    "ImageComments",
    "RETIRED_ImagePresentationComments",
    "RETIRED_StudyIDIssuer",
    "RETIRED_ScheduledStudyLocation",
    "RETIRED_ScheduledStudyLocationAETitle",
    "RETIRED_ReasonForStudy",
    "RequestingPhysician",
    "RequestingService",
    "RequestedProcedureDescription",
    "RequestedContrastAgent",
    "RETIRED_StudyComments",
    "AdmissionID",
    "RETIRED_IssuerOfAdmissionID",
    "RETIRED_ScheduledPatientInstitutionResidence",
    "AdmittingDate",
    "AdmittingTime",
    "RETIRED_DischargeDiagnosisDescription",
    "SpecialNeeds",
    "ServiceEpisodeID",
    "RETIRED_IssuerOfServiceEpisodeID",
    "ServiceEpisodeDescription",
    "CurrentPatientLocation",
    "PatientInstitutionResidence",
    "PatientState",
    "ReferencedPatientAliasSequence",
    "VisitComments",
    "ScheduledStationAETitle",
    "ScheduledPerformingPhysicianName",
    "ScheduledProcedureStepDescription",
    "ScheduledStationName",
    "ScheduledProcedureStepLocation",
    "PreMedication",
    "PerformedStationAETitle",
    "PerformedStationName",
    "PerformedLocation",
    "PerformedStationNameCodeSequence",
    "PerformedProcedureStepID",
    "PerformedProcedureStepDescription",
    "RequestAttributesSequence",
    "CommentsOnThePerformedProcedureStep",
    "AcquisitionContextSequence",
    "PatientTransportArrangements",
    "RequestedProcedureLocation",
    "NamesOfIntendedRecipientsOfResults",
    "IntendedRecipientsOfResultsIdentificationSequence",
    "PersonAddress",
    "PersonTelephoneNumbers",
    "RequestedProcedureComments",
    "RETIRED_ReasonForTheImagingServiceRequest",
    "OrderEnteredBy",
    "OrderEntererLocation",
    "OrderCallbackPhoneNumber",
    "ImagingServiceRequestComments",
    "ConfidentialityConstraintOnPatientDataDescription",
    "ScheduledStationNameCodeSequence",
    "ScheduledStationGeographicLocationCodeSequence",
    "PerformedStationGeographicLocationCodeSequence",
    "ScheduledHumanPerformersSequence",
    "ActualHumanPerformersSequence",
    "HumanPerformerOrganization",
    "HumanPerformerName",
    "VerifyingOrganization",
    "VerifyingObserverName",
    "AuthorObserverSequence",
    "ParticipantSequence",
    "CustodialOrganizationSequence",
    "VerifyingObserverIdentificationCodeSequence",
    "PersonName",
    "ContentSequence",
    "OverlayData",
    "RETIRED_OverlayComments",
    "IconImageSequence",
    "RETIRED_TopicSubject",
    "RETIRED_TopicAuthor",
    "RETIRED_TopicKeywords",
    "TextString",
    "RETIRED_Arbitrary",
    "RETIRED_TextComments",
    "RETIRED_ResultsIDIssuer",
    "RETIRED_InterpretationRecorder",
    "RETIRED_InterpretationTranscriber",
    "RETIRED_InterpretationText",
    "RETIRED_InterpretationAuthor",
    "RETIRED_InterpretationApproverSequence",
    "RETIRED_PhysicianApprovingInterpretation",
    "RETIRED_InterpretationDiagnosisDescription",
    "RETIRED_ResultsDistributionListSequence",
    "RETIRED_DistributionName",
    "RETIRED_DistributionAddress",
    "RETIRED_InterpretationIDIssuer",
    "RETIRED_Impressions",
    "RETIRED_ResultsComments",
    "DigitalSignaturesSequence",
    "DataSetTrailingPadding"
];

export function getTagsNameToEmpty() {
    return [...tagNamesToEmpty];
}

export function cleanTags(
    dict,
    tagNamesToReplace = undefined,
    customTagNamesToEmpty = undefined
) {
    if (tagNamesToReplace == undefined) {
        tagNamesToReplace = {
            "00100010": "ANON^PATIENT",
            "00100020": "ANON^ID"
        };
    }
    var tags =
        customTagNamesToEmpty != undefined
            ? customTagNamesToEmpty
            : tagNamesToEmpty;
    tags.forEach(function (tag) {
        var tagInfo = DicomMetaDictionary.nameMap[tag];
        if (tagInfo && tagInfo.version != "PrivateTag") {
            var tagNumber = tagInfo.tag,
                tagString = Tag.fromPString(tagNumber).toCleanString();
            if (dict[tagString]) {
                var newValue;
                if (tagString in tagNamesToReplace) {
                    newValue = [tagNamesToReplace[tagString]];
                } else {
                    newValue = [];
                }
                dict[tagString] = ValueRepresentation.addTagAccessors(
                    dict[tagString]
                );
                dict[tagString].Value = newValue;
            }
        }
    });
}
