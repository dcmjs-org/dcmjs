// Moved to packages/core; this shim keeps the old import path working.
// It imports @dcmjs-org/core, so the ESM build keeps one copy of it.
export {
    BULKDATA_VRS,
    DEFAULT_INFORMATION_TAGS,
    DEFLATED_EXPLICIT_LITTLE_ENDIAN,
    EXPLICIT_BIG_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    ITEM_DELIMITATION_LENGTH,
    PADDING_NULL,
    PADDING_SPACE,
    PN_COMPONENT_DELIMITER,
    SEQUENCE_DELIMITATION_VALUE,
    SEQUENCE_DELIMITER_TAG,
    SEQUENCE_ITEM_TAG,
    TAG_NAME_MAP,
    TagHex,
    UNDEFINED_LENGTH,
    UNDEFINED_LENGTH_FIX,
    VALID_VRS,
    VM_DELIMITER,
    encodingMapping,
    isEncapsulatedSyntax,
    isVideoTransferSyntax,
    singleVRs,
    unencapsulatedTransferSyntaxes,
    videoTransferSyntaxUIDs
} from "@dcmjs-org/core";
