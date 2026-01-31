// TransferSyntaxUIDs
export const IMPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2";
export const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";
export const DEFLATED_EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1.99";
export const EXPLICIT_BIG_ENDIAN = "1.2.840.10008.1.2.2";

/**
 * The raw hex value is the maximum 32 bit unsigned integer,
 * but this is a potential length value, so suggest using the
 * canonical UNDEFINED_LENGTH_FIX value of -1 instead
 */
export const UNDEFINED_LENGTH = 0xffffffff;
/**
 * Use a -1 value for the undefined length being fixed as this is consistent
 * with other usage and can't be confused with a real length.
 */
export const UNDEFINED_LENGTH_FIX = -1;
export const ITEM_DELIMITATION_LENGTH = 0x00000000;

// Delimitation Value
export const SEQUENCE_DELIMITATION_VALUE = 0x00000000;

// Value multiplicity and padding
export const VM_DELIMITER = 0x5c;
export const PADDING_NULL = 0x00;
export const PADDING_SPACE = 0x20;

// PersonName delimeters
export const PN_COMPONENT_DELIMITER = 0x3d;

export const SEQUENCE_ITEM_TAG = 0xfffee000;
export const SEQUENCE_DELIMITER_TAG = 0xfffee0dd;

// Nearly all transfer syntaxes are encapsulated, so record those which are
// unencapsulated as the exceptions.
export const unencapsulatedTransferSyntaxes = {
    [IMPLICIT_LITTLE_ENDIAN]: true,
    [EXPLICIT_BIG_ENDIAN]: true,
    [DEFLATED_EXPLICIT_LITTLE_ENDIAN]: true,
    [EXPLICIT_LITTLE_ENDIAN]: true
};

/**
 * This is an enumeration of some HEX values for the tag strings, used to replace
 * constants in a few places.
 */
export const TagHex = {
    Item: "FFFEE000",
    ItemDelimitationEnd: "FFFEE00D",
    SequenceDelimitationEnd: "FFFEE0DD",
    PixelData: "7FE00010",
    FileMetaInformationGroupLength: "00020000",
    TransferSyntaxUID: "00020010",
    Rows: "00280010",
    Columns: "00280011",
    SamplesPerPixel: "00280002",
    BitsAllocated: "00280100",
    NumberOfFrames: "00280008",
    SpecificCharacterSet: "00080005",
    PixelRepresentation: "00280103",
    DataSetTrailingPadding: "FFFCFFFC"
};

export const encodingMapping = {
    "": "iso-8859-1",
    "iso-ir-6": "iso-8859-1",
    "iso-ir-13": "shift-jis",
    "iso-ir-100": "latin1",
    "iso-ir-101": "iso-8859-2",
    "iso-ir-109": "iso-8859-3",
    "iso-ir-110": "iso-8859-4",
    "iso-ir-126": "iso-ir-126",
    "iso-ir-127": "iso-ir-127",
    "iso-ir-138": "iso-ir-138",
    "iso-ir-144": "iso-ir-144",
    "iso-ir-148": "iso-ir-148",
    "iso-ir-166": "tis-620",
    "iso-2022-ir-6": "iso-8859-1",
    "iso-2022-ir-13": "shift-jis",
    "iso-2022-ir-87": "iso-2022-jp",
    "iso-2022-ir-100": "latin1",
    "iso-2022-ir-101": "iso-8859-2",
    "iso-2022-ir-109": "iso-8859-3",
    "iso-2022-ir-110": "iso-8859-4",
    "iso-2022-ir-126": "iso-ir-126",
    "iso-2022-ir-127": "iso-ir-127",
    "iso-2022-ir-138": "iso-ir-138",
    "iso-2022-ir-144": "iso-ir-144",
    "iso-2022-ir-148": "iso-ir-148",
    "iso-2022-ir-149": "euc-kr",
    "iso-2022-ir-159": "iso-2022-jp",
    "iso-2022-ir-166": "tis-620",
    "iso-2022-ir-58": "iso-ir-58",
    "iso-ir-192": "utf-8",
    gb18030: "gb18030",
    "iso-2022-gbk": "gbk",
    "iso-2022-58": "gb2312",
    gbk: "gbk"
};
