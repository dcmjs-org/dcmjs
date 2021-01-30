export as namespace dcmjs;

declare namespace data {

  export class DicomMetaDictionary {
    static uid (): string
    static date (): string
    static time (): string
    static dateTime (): string
    static denaturalizeDataset (object): object
    static naturalizeDataset (object): object
    static namifyDataset (object): object
    static cleanDataset (object): object
    static punctuateTag (string): string
    static unpunctuateTag (string): string
  }

  export class DicomDict {
    constructor (meta: object)
    dict: object
    write (writeOptions?: object): string
  }

  export class DicomMessage {
    static readFile (string): DicomDict
  }

}


declare namespace sr {

  declare namespace coding {

    export interface CodeOptions {
      value: string
      meaning: string
      schemeDesignator: string
      schemeVersion?: string
    }

    export class Code {
      constructor (options: CodeOptions)
      public get value(): string
      public get meaning(): string
      public get schemeDesignator(): string
      public get schemeVersion(): string | null
    }

    export interface CodedConceptOptions {
      value: string
      meaning: string
      schemeDesignator: string
      schemeVersion?: string
    }

    export class CodedConcept {
      constructor (options: CodedConceptOptions)
      equals(other: CodedConcept): boolean
      get value(): string
      get meaning(): string
      get schemeDesignator(): string
      get schemeVersion(): string | null
      CodeValue: string
      CodeMeaning: string
      CodingSchemeDesignator: string
      CodingSchemeVersion?: string
    }

  }

  declare namespace contentItems {

    export interface FindingSiteOptions {
      anatomicLocation: dcmjs.sr.coding.CodedConcept
      lateratlity?: dcmjs.sr.coding.CodedConcept
      topographicalModifier?: dcmjs.sr.coding.CodedConcept
    }

    export class FindingSite extends dcmjs.sr.valueTypes.CodeContentItem {
      constructor (options: FindingSiteOptions)
    }

    export interface LongitudinalTemporalOffsetFromEventOptions {
      value: number
      unit: dcmjs.sr.coding.CodedConcept
      eventType: dcmjs.sr.coding.CodedConcept
    }

    export class LongitudinalTemporalOffsetFromEvent extends dcmjs.sr.valueTypes.NumContentItem {
      constructor (options: LongitudinalTemporalOffsetFromEventOptions)
    }

    export interface ImageRegionOptions {
      graphicType: string
      graphicData: number[][]
      pixelOriginInterpretation: string
      sourceImage: SourceImageForRegion
    }

    export class ImageRegion extends dcmjs.sr.valueTypes.ScoordContentItem {
      constructor (options: ImageRegionOptions)
    }

    export interface ImageRegion3DOptions {
      graphicType: string
      graphicData: number[][] | number[]
      frameOfReferenceUID: string
    }

    export class ImageRegion3D extends dcmjs.sr.valueTypes.Scoord3DContentItem {
      constructor (options: ImageRegion3DOptionsOptions)
    }

    export interface ReferencedRealWorldValueMapOptions {
      referencedSOPClassUID: string
      referencedSOPInstanceUID: string
    }

    export class ReferencedRealWorldValueMap extends dcmjs.sr.valueTypes.CompositeContentItem {
      constructor (options: ReferencedRealWorldValueMapOptions)
    }

    export interface ReferencedSegmentationOptions {
      sopClassUID: string
      sopInstanceUID: string
      segmentNumber?: number
      frameNumbers?: number[]
      sourceImages?: SourceImageForSegmentation[]
    }

    export class ReferencedSegmentation extends dcmjs.sr.valueTypes.ContentSequence {
      constructor (options: ReferencedSegmentationOptions)
    }

    export interface ReferencedSegmentationFrameOptions {
      sopClassUID: string
      sopInstanceUID: string
      segmentNumber?: number
      frameNumber?: number
      sourceImage?: SourceImageForSegmentation
    }

    export class ReferencedSegmentationFrame extends dcmjs.sr.valueTypes.ContentSequence {
      constructor (options: ReferencedSegmentationFrameOptions)
    }

    export interface VolumeSurfaceOptions {
      graphicType: string
      graphicData: number[][]  // TODO
      frameOfReferenceUID: string
      sourceImages?: SourceImageForRegion[]
      sourceSeries?: SourceSeriesForRegion
    }

    export class VolumeSurface extends dcmjs.sr.valueTypes.Scoord3DContentItem {
      constructor (options: VolumeSurfaceOptions)
    }

    export interface SourceImageForRegionOptions {
      referencedSOPClassUID: string
      referencedSOPInstanceUID: string
      referencedFrameNumbers: string
    }

    export class SourceImageForRegion {
      constructor (options: SourceImageForRegionOptions)
    }

    export interface SourceImageForSegmentationOptions {
      referencedSOPClassUID: string
      referencedSOPInstanceUID: string
      referencedFrameNumbers: string
    }

    export class SourceImageForSegmentation {
      constructor (options: SourceImageForSegmentationOptions)
    }

    export interface SourceSeriesForSegmentationOptions {
      referencedSeriesInstanceUID: string
    }

    export class SourceSeriesForSegmentation {
      constructor (options: SourceSeriesForSegmentationOptions)
    }

  }

  declare namespace documents {

    export interface Comprehensive3DSROptions {
      content: object
      evidence: object[]
      seriesInstanceUID: string
      seriesNumber: number
      seriesDescription: string
      sopInstanceUID: string
      instanceNumber: number
      manufacturer: string
      institutionName?: string
      institutionDepartmentName?: string
      isComplete?: boolean
      isVerified?: boolean
      verifyingObserverName?: string
      verifyingObserverOrganization?: string
      isFinal?: boolean
      requestedProcedures?: object[]
      previousVersions?: object[]
      performedProcedureCodes?: object[]
    }

    export class Comprehensive3DSR {
      constructor (options: Comprehensive3DSROptions)
    }

  }

  declare namespace templates {

    export abstract class Template extends Array<dcmjs.sr.valueTypes.ContentItem> {}

    export interface TrackingIdentifierOptions {
      uid: string
      identifier?: string
    }

    export class TrackingIdentifier extends Template {
      constructor (options: TrackingIdentifierOptions)
    }

    export interface AlgorithmIdentificationOptions {
      name: string
      version: string
      parameters?: string[]
    }

    export class AlgorithmIdentification extends Template {
      constructor (options: AlgorithmIdentificationOptions)
    }

    export interface MeasurmentOptions {
      name: dcmjs.sr.coding.CodedConcept
      value: number
      uint: dcmjs.sr.coding.CodedConcept
      trackingIdentifier: TrackingIdentifier
      qualifier?: dcmjs.sr.coding.CodedConcept
      method?: dcmjs.sr.coding.CodedConcept
      derivation?: dcmjs.sr.coding.CodedConcept
      findingSites?: dmjs.sr.contentItems.FindingSite[]
      properties?: MeasurmentProperties
      referencedRegions?: (
        dmjs.sr.contentItems.ImageRegion[] |
        dmjs.sr.contentItems.ImageRegion3D[]
      )
      referencedVolume?: dmjs.sr.contentItems.VolumeSurface
      referencedSegmentation?: (
        dmjs.sr.contentItems.ReferencedSegmentation |
        dmjs.sr.contentItems.ReferencedSegmentationFrame
      )
      referencedRealWorldValueMap?: dmjs.sr.contentItems.ReferencedRealWorldValueMap
      algorithmId?: AlgorithmIdentification
    }

    export class Measurement extends Template {
      constructor (options: MeasurmentOptions)
    }

    export interface MeasurementPropertiesOptions {
      normality?: dcmjs.sr.coding.CodedConcept
      levelOfSignificance?: dcmjs.sr.coding.CodedConcept
      measurementStatisticalProperties?: MeasurementStatisticalProperties
      normalRangeProperties?: NormalRangeProperties
      selectionStatus?: dcmjs.sr.coding.CodedConcept
      lowerMeasurementUncertainty?: dcmjs.sr.coding.CodedConcept
      upperMeasurementUncertainty?: dcmjs.sr.coding.CodedConcept
    }

    export class MeasurementProperties extends Template {
      constructor (options: MeasurementPropertiesOptions)
    }

    export interface MeasurementStatisticalPropertiesOptions {
      values: dcmjs.sr.valueTypes.NumContentItem[]
      description?: string
      authority?: string
    }

    export class MeasurementStatisticalProperties extends Template {
      constructor (options: MeasurementStatisticalPropertiesOptions)
    }

    export interface NormalRangePropertiesOptions {
      values: dcmjs.sr.valueTypes.NumContentItem[]
      description?: string
      authority?: string
    }

    export class NormalRangeProperties extends Template {
      constructor (options: NormalRangePropertiesOptions)
    }

    export interface ObservationContextOptions {
      observerPersonContext: ObserverContext
      observerDeviceContext?: ObserverContext
      subjectContext?: SubjectContext
    }

    export class ObservationContext extends Template {
      constructor (options: ObservationContextOptions)
    }

    export interface ObserverContextOptions {
      observerType: dcmjs.sr.coding.CodedConcept | dcmjs.sr.coding.Code
      observerIdentifyingAttributes: (
        PersonObserverIdentifyingAttributes |
        DeviceObserverIdentifyingAttributes
      )
    }

    export class ObserverContext extends Template {
      constructor (options: ObserverContextOptions)
    }

    export interface PersonObserverIdentifyingAttributesOptions {
      name: string
      loginName?: string
      organizationName?: string
      roleInOrganization?: dcmjs.sr.coding.CodedConcept
      roleInProcedure?: dcmjs.sr.coding.CodedConcept
    }

    export class PersonObserverIdentifyingAttributes extends Template {
      constructor (options: PersonObserverIdentifyingAttributesOptions)
    }

    export interface DeviceObserverIdentifyingAttributesOptions {
      uid: string
      manufacturerName?: string
      modelName?: string
      serialNumber?: string
      physicalLocation?: string
      roleInProcedure?: dcmjs.sr.coding.CodedConcept
    }

    export class DeviceObserverIdentifyingAttributes extends Template {
      constructor (options: DeviceObserverIdentifyingAttributesOptions)
    }

    export interface SubjectContextOptions {
      subjectClass: dcmjs.sr.coding.CodedConcept
      subjectClassSpecificContext: (
        SubjectContextFetus |
        SubjectContextSpecimen |
        SubjectContextDevice
      )
    }

    export class SubjectContext extends Template {
      constructor (options: SubjectContextOptions)
    }

    export interface SubjectContextFetusOptions {
      subjectID: string
    }

    export class SubjectContextFetus extends Template {
      constructor (options: SubjectContextFetusOptions)
    }

    export interface SubjectContextSpecimenOptions {
      uid: string
      identifier?: string
      containerIdentifier?: string
      specimenType?: dcmjs.sr.coding.CodedConcept
    }

    export class SubjectContextSpecimen extends Template {
      constructor (options: SubjectContextSpecimenOptions)
    }

    export interface SubjectContextDeviceOptions {
      name: string
      uid?: string
      manufacturerName?: string
      modelName?: string
      serialNumber?: string
      physicalLocation?: string
    }

    export class SubjectContextDevice extends Template {
      constructor (options: SubjectContextDeviceOptions)
    }

    export interface LanguageOfContentItemAndDescendantsOptions {
      language?: dcmjs.sr.coding.CodedConcept
    }

    export class LanguageOfContentItemAndDescendants extends Template {
      constructor (options: LanguageOfContentItemAndDescendantsOptions)
    }

    export interface PlanarROIMeasurementsAndQualitativeEvaluationsOptions {
      trackingIdentifier: TrackingIdentifier
      session?: string
      findingType?: dcmjs.sr.coding.CodedConcept
      referencedRegion?: (
        dcmjs.sr.contentItems.ImageRegion |
        dcmjs.sr.contentItems.ImageRegion3D
      )
      referencedSegmentation?: (
        dcmjs.sr.contentItems.ReferencedSegmentation |
        dcmjs.sr.contentItems.ReferencedSegmentationFrame
      )
      referencedRealWorldValueMap?: dcmjs.sr.contentItems.ReferencedRealWorldValueMap
      timePointContext?: TimePointContext
      measurements?: Measurement[]
      qualitativeEvaluations?: dcmjs.sr.valueTypes.CodeContentItem[]
    }

    export class PlanarROIMeasurementsAndQualitativeEvaluations extends Template {
      constructor (options: PlanarROIMeasurementsAndQualitativeEvaluationsOptions)
    }

    export interface VolumetricROIMeasurementsAndQualitativeEvaluationsOptions {
      trackingIdentifier: TrackingIdentifier
      session?: string
      findingType?: dcmjs.sr.coding.CodedConcept
      referencedRegions?: (
        dcmjs.sr.contentItems.ImageRegion[] |
        dcmjs.sr.contentItems.ImageRegion3D[]
      )
      referencedSegmentation?: (
        dcmjs.sr.contentItems.ReferencedSegmentation |
        dcmjs.sr.contentItems.ReferencedSegmentationFrame
      )
      referencedRealWorldValueMap?: dcmjs.sr.contentItems.ReferencedRealWorldValueMap
      timePointContext?: TimePointContext
      measurements?: Measurement[]
      qualitativeEvaluations?: dcmjs.sr.valueTypes.CodeContentItem[]
    }

    export class VolumetricROIMeasurementsAndQualitativeEvaluations extends Template {
      constructor (options: VolumetricROIMeasurementsAndQualitativeEvaluationsOptions)
    }

    export interface MeasurementsDerivedFromMultipleROIMeasurementsOptions {
      derivation: dcmjs.sr.coding.CodedConcept
      measurementGroup: (
        PlanarROIMeasurementsAndQualitativeEvaluations |
        VolumetricROIMeasurementsAndQualitativeEvaluations
      )
      measurementProperties?: MeasurementProperties
    }

    export class MeasurementsDerivedFromMultipleROIMeasurements extends Template {
      constructor (options: MeasurementsDerivedFromMultipleROIMeasurementsOptions)
    }

    export interface MeasurementAndQualitativeEvaluationGroupOptions {
      trackingIdentifier: TrackingIdentifier
      session?: string
      findingType?: dcmjs.sr.coding.CodedConcept
      referencedRealWorldValueMap?: dcmjs.sr.contentItems.ReferencedRealWorldValueMap
      timePointContext?: TimePointContext
      measurements?: Measurement[]
      qualitativeEvaluations?: dcmjs.sr.valueTypes.CodeContentItem[]
    }

    export class MeasurementAndQualitativeEvaluationGroup {
      constructor (options: MeasurementAndQualitativeEvaluationGroupOptions)
    }

    export interface ROIMeasurementsOptions {
      method?: dcmjs.sr.coding.CodedConcept
      findingSites?: dcmjs.sr.contentItem.FindingSite[]
      measurements?: Measurement[]
    }

    export class ROIMeasurements extends Template {
      constructor (options: ROIMeasurementsOptions)
    }

    export interface MeasurementReportOptions {
      observationContext: ObservationContext
      procedureReported: dcmjs.sr.coding.CodedConcept
      languageOfContentItemAndDescendants?: LanguageOfContentItemAndDescendants
      imagingMeasurements?: Measurement[]  // TODO
      derivedImagingMeasurements?: Measurement[]
      qualitativeEvaluations?: dcmjs.sr.valueTypes.CodeContentItem[]
    }

    export class MeasurementReport extends Template {
      constructor (options: MeasurementReportOptions)
    }

    export interface TimePointContextOptions {
      timePoint: string
      timePointType?: dcmjs.sr.coding.CodedConcept
      timePointOrder?: number
      subjectTimePointIdentifier?: number
      protocolTimePointIdentifier?: number
      temporalOffsetFromEvent?: dcmjs.sr.contentItems.LongitudinalTemporalOffsetFromEventContentItem
    }

    export class TimePointContext extends Template {
      constructor (options: TimePointContextOptions)
    }

  }

  declare namespace valueTypes {

    export interface MeasuredValue {
      MeasurementUnitsCodeSequence: dcmjs.sr.coding.CodedConcept[]
      NumericValue: number
      FloatingPointValue?: number
    }

    export class ContentItem {
      ConceptNameCodeSequence: dcmjs.sr.coding.CodedConcept[]
      RelationshipType: string
      ValueType: string
    }

    export interface NumContentItemOptions {
      name: dcmjs.sr.coding.CodedConcept
      relationshipType: string
      value: number
      unit: dcmjs.sr.coding.CodedConcept
      qualifier?: dcmjs.sr.coding.CodedConcept
    }

    export class NumContentItem extends ContentItem {
      constructor (options: NumContentItemOptions)
      MeasuredValueSequence: MeasuredValue[]
      NumericValueQualifierCodeSequence?: dcmjs.sr.coding.CodedConcept[]
    }

    export interface ContainerContentItemOptions {
      name: dcmjs.sr.coding.CodedConcept
      relationshipType: string
      templateID?: string
      isContentContinuous?: boolean
    }

    export class ContainerContentItem extends ContentItem {
      constructor (options: ContainerContentItemOptions)
      ContentSequence: ContentItem[]
    }

    export interface UIDRefContentItemOptions {
      name: dcmjs.sr.coding.CodedConcept
      relationshipType: string
      value: string
    }

    export class UIDRefContentItem extends ContentItem {
      constructor (options: UIDRefContentItemOptions)
      UID: string
    }

    export interface CodeContentItemOptions {
      name: dcmjs.sr.coding.CodedConcept
      relationshipType: string
      value: dcmjs.sr.coding.CodedConcept
    }

    export class CodeContentItem extends ContentItem {
      constructor (options: CodeContentItemOptions)
      ConceptCodeSequence: dcmjs.sr.coding.CodedConcept[]
    }

    export interface TextContentItemOptions {
      name: dcmjs.sr.coding.CodedConcept
      relationshipType: string
      value: string
    }

    export class TextContentItem extends ContentItem {
      constructor (options: TextContentItemOptions)
      TextValue: string
    }

    export interface PNameContentItemOptions {
      name: dcmjs.sr.coding.CodedConcept
      relationshipType: string
      value: string
    }

    export class PNameContentItem extends ContentItem {
      constructor (options: PNameContentItemOptions)
      PersonName: string
    }

    export interface DateTimeContentItemOptions {
      name: dcmjs.sr.coding.CodedConcept
      relationshipType: string
      value: string
    }

    export class DateTimeContentItem extends ContentItem {
      constructor (options: DateTimeContentItemOptions)
      DateTime: string
    }

    export interface Scoord3DContentItemOptions {
      name: dcmjs.sr.coding.CodedConcept
      relationshipType: string
      graphicType: string
      graphicData: number[][] | number[]
    }

    export class Scoord3DContentItem extends ContentItem {
      constructor (options: Scoord3DContentItemOptions)
      GraphicType: string
      GraphicData: number[]
      ReferencedFrameOfReferenceUID: string
    }

    export class ContentSequence extends Array<ContentItem> {}

  }

}
