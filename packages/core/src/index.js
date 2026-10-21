// The public surface of @dcmjs-org/core.
//
// The packed dictionary data modules (dicom.packed.js,
// dictionary.private.data.js, dictionary.ranges.data.js) are deliberately
// absent: their export names collide by design (each is a module-shaped
// data blob), so consumers that need them import them by module path.
export { ValueRepresentation } from "./ValueRepresentation.js";
export { Tag } from "./Tag.js";
export {
    BufferStream,
    ReadBufferStream,
    WriteBufferStream,
    DeflatedReadBufferStream
} from "./BufferStream.js";
export { default as SplitDataView } from "./SplitDataView.js";
export { DicomMetaDictionary } from "./DicomMetaDictionary.js";
export { log, validationLog } from "./log.js";
export * from "./constants/dicom.js";
export {
    registerPrivatesModule,
    registerTag,
    lookupRegisteredTagByName,
    dictionary
} from "./dictionary.fast.js";
export {
    lookupTagHex,
    lookupTagRangeHex,
    getAllStandardTagEntries
} from "./dicom.lookup.js";
// The one function the packed private dictionary exposes by name; the data
// blobs around it stay module-path imports per the note above.
export { lookupPrivateTag } from "./dictionary.private.data.js";
export {
    resolveCharsetDecoder,
    Iso2022Decoder,
    PN_DELIMITER_BYTES
} from "./charset/iso2022.js";
export { createDecoder, createLatin1Decoder } from "./charset/latin1.js";
export { normalizeSyntax } from "./core/normalizeSyntax.js";
export {
    writeDataSet,
    writeTagObject,
    getTagWriteValues,
    writePart10
} from "./core/writeCore.js";
export { toFloat } from "./utilities/toFloat.js";
export { toInt } from "./utilities/toInt.js";
export { deepEqual } from "./utilities/deepEqual.js";
export { toStringFirst, toFloatFirst } from "./utilities/firstValue.js";
export { MODALITY_DISPLAY } from "./constants/modality.js";
export { encodeBase64, base64ToArrayBuffer } from "./utilities/base64.js";
export { deepCloneInstance } from "./utilities/deepCloneInstance.js";
export { default as addAccessors } from "./utilities/addAccessors.js";
export { default as isMultiVM } from "./utilities/isMultiVM.js";
export { default as BINARY_VRS } from "./utilities/binaryVRs.js";
export { default as dicomJson } from "./utilities/dicomJson.js";
export {
    checkBinaryAs,
    naturalBinaryFragment
} from "./utilities/binaryFragment.js";
export {
    isPrivateTag,
    placePrivateElements,
    definePrivateAliases,
    expandPrivateBlocks
} from "./utilities/privateBlocks.js";
export {
    DicomMetadataListener,
    createInformationFilter
} from "./utilities/DicomMetadataListener.js";
export {
    patientTags,
    studyTags,
    seriesTags,
    patientStudyTags,
    copyAttributesByLevel,
    extendDataLevels,
    dataLevelIndex,
    DATA_LEVELS
} from "./utilities/copyAttributesByLevel.js";
export {
    createInstance,
    combineBases,
    resolveBase,
    patientBase,
    studyBase,
    seriesBase,
    instanceBase,
    equipmentBase,
    predecessorBase,
    hierarchicalReferences,
    defaultInstanceBase,
    nextSeriesNumberBase,
    removeUndefinedAttributes
} from "./utilities/createInstance.js";
