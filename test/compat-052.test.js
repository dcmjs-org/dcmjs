// test/compat-052.test.js
//
// WRAP-USR-1 (RELEASE_PLAN.md section 6): the wrapper keeps every export
// name of dcmjs 0.52.0. The lists below come from the 0.52.0 npm build. A
// namespace may add names, but a removed name fails here.

import dcmjs from "../src/index.js";

const EXPORTS_052 = {
    adapters: [
        "Cornerstone",
        "Cornerstone3D",
        "VTKjs",
        "DICOMMicroscopyViewer"
    ],
    constants: [
        "BULKDATA_VRS",
        "DEFAULT_INFORMATION_TAGS",
        "DEFLATED_EXPLICIT_LITTLE_ENDIAN",
        "EXPLICIT_BIG_ENDIAN",
        "EXPLICIT_LITTLE_ENDIAN",
        "IMPLICIT_LITTLE_ENDIAN",
        "ITEM_DELIMITATION_LENGTH",
        "PADDING_NULL",
        "PADDING_SPACE",
        "PN_COMPONENT_DELIMITER",
        "SEQUENCE_DELIMITATION_VALUE",
        "SEQUENCE_DELIMITER_TAG",
        "SEQUENCE_ITEM_TAG",
        "TAG_NAME_MAP",
        "TagHex",
        "UNDEFINED_LENGTH",
        "UNDEFINED_LENGTH_FIX",
        "VALID_VRS",
        "VM_DELIMITER",
        "encodingMapping",
        "isVideoTransferSyntax",
        "unencapsulatedTransferSyntaxes",
        "videoTransferSyntaxUIDs"
    ],
    data: [
        "BitArray",
        "ReadBufferStream",
        "DeflatedReadBufferStream",
        "WriteBufferStream",
        "DicomDict",
        "DicomMessage",
        "DicomMetaDictionary",
        "Tag",
        "ValueRepresentation",
        "Colors",
        "datasetToDict",
        "datasetToBuffer",
        "datasetToBlob"
    ],
    derivations: [
        "DerivedDataset",
        "DerivedPixels",
        "DerivedImage",
        "Segmentation",
        "StructuredReport",
        "ParametricMap"
    ],
    normalizers: [
        "Normalizer",
        "ImageNormalizer",
        "MRImageNormalizer",
        "EnhancedMRImageNormalizer",
        "EnhancedUSVolumeNormalizer",
        "CTImageNormalizer",
        "PETImageNormalizer",
        "SEGImageNormalizer",
        "DSRNormalizer"
    ],
    sr: ["coding", "contentItems", "documents", "templates", "valueTypes"],
    utilities: [
        "TID1500",
        "TID300",
        "message",
        "addAccessors",
        "orientation",
        "compression",
        "dicomJson",
        "DicomMetadataListener",
        "ArrayBufferExpanderFilter",
        "toFloat",
        "toInt",
        "createInformationFilter"
    ],
    anonymizer: ["cleanTags", "getTagsNameToEmpty"],
    async: ["AsyncDicomReader"]
};

// Top-level names with no namespace keys to compare: DICOMWEB is a class,
// and log is the loglevel logger. The default export has exactly these;
// the new engines are subpath entries only (WRAP-USR-3).
const TOP_LEVEL_052 = [...Object.keys(EXPORTS_052), "DICOMWEB", "log"];

describe("dcmjs 0.52 compatibility", () => {
    test("every 0.52 export name is still exported", () => {
        expect(Object.keys(dcmjs).sort()).toEqual([...TOP_LEVEL_052].sort());
        for (const [namespace, names] of Object.entries(EXPORTS_052)) {
            expect({
                namespace,
                keys: Object.keys(dcmjs[namespace])
            }).toEqual({ namespace, keys: expect.arrayContaining(names) });
        }
    });
});
