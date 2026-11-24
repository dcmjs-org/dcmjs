/**
 * SOP Class UIDs by name (a subset of PS3.4 B.5): `SopClasses.CTImage`.
 * It is also `DicomMetaDictionary.sopClassUIDsByName`.
 * @typedef {typeof SopClasses} SopClassRegistry
 * @type {Object<string, string>}
 */
export const SopClasses = {
    NMImage: "1.2.840.10008.5.1.4.1.1.20",
    CTImage: "1.2.840.10008.5.1.4.1.1.2",
    EnhancedCTImage: "1.2.840.10008.5.1.4.1.1.2.1",
    LegacyConvertedEnhancedCTImage: "1.2.840.10008.5.1.4.1.1.2.2",
    USMultiframeImage: "1.2.840.10008.5.1.4.1.1.3.1",
    MRImage: "1.2.840.10008.5.1.4.1.1.4",
    EnhancedMRImage: "1.2.840.10008.5.1.4.1.1.4.1",
    MRSpectroscopy: "1.2.840.10008.5.1.4.1.1.4.2",
    EnhancedMRColorImage: "1.2.840.10008.5.1.4.1.1.4.3",
    LegacyConvertedEnhancedMRImage: "1.2.840.10008.5.1.4.1.1.4.4",
    USImage: "1.2.840.10008.5.1.4.1.1.6.1",
    EnhancedUSVolume: "1.2.840.10008.5.1.4.1.1.6.2",
    SecondaryCaptureImage: "1.2.840.10008.5.1.4.1.1.7",
    ParametricMapStorage: "1.2.840.10008.5.1.4.1.1.30",
    RawData: "1.2.840.10008.5.1.4.1.1.66",
    SpatialRegistration: "1.2.840.10008.5.1.4.1.1.66.1",
    SpatialFiducials: "1.2.840.10008.5.1.4.1.1.66.2",
    DeformableSpatialRegistration: "1.2.840.10008.5.1.4.1.1.66.3",
    Segmentation: "1.2.840.10008.5.1.4.1.1.66.4",
    LabelmapSegmentation: "1.2.840.10008.5.1.4.1.1.66.7",
    RealWorldValueMapping: "1.2.840.10008.5.1.4.1.1.67",
    BasicTextSR: "1.2.840.10008.5.1.4.1.1.88.11",
    EnhancedSR: "1.2.840.10008.5.1.4.1.1.88.22",
    ComprehensiveSR: "1.2.840.10008.5.1.4.1.1.88.33",
    Comprehensive3DSR: "1.2.840.10008.5.1.4.1.1.88.34",
    PETImage: "1.2.840.10008.5.1.4.1.1.128",
    EnhancedPETImage: "1.2.840.10008.5.1.4.1.1.130",
    LegacyConvertedEnhancedPETImage: "1.2.840.10008.5.1.4.1.1.128.1",
    OphthalmicPhotography8BitImage: "1.2.840.10008.5.1.4.1.1.77.1.5.1",
    OphthalmicTomographyImage: "1.2.840.10008.5.1.4.1.1.77.1.5.4"
};

/** UID -> name; also `DicomMetaDictionary.sopClassNamesByUID`. */
export const sopClassNamesByUID = Object.fromEntries(
    Object.entries(SopClasses).map(([name, uid]) => [uid, name])
);

/** Adds or replaces a SOP class name and UID. */
export function registerSopClass(name, uid) {
    SopClasses[name] = uid;
    sopClassNamesByUID[uid] = name;
}

/** The name of a SOP Class UID, or undefined. */
export function sopClassName(uid) {
    return Object.hasOwn(sopClassNamesByUID, uid)
        ? sopClassNamesByUID[uid]
        : undefined;
}
