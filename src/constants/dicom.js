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
    IMPLICIT_LITTLE_ENDIAN: true,
    EXPLICIT_BIG_ENDIAN: true,
    DEFLATED_EXPLICIT_LITTLE_ENDIAN: true,
    EXPLICIT_LITTLE_ENDIAN: true
};

/**
 * Video transfer syntax UIDs (MPEG2, H.264, H.265)
 * These transfer syntaxes treat the entire pixel data stream as a single frame
 * regardless of the number of fragments.
 */
export const videoTransferSyntaxUIDs = new Set([
    "1.2.840.10008.1.2.4.100", // MPEG2 Main Profile @ Main Level
    "1.2.840.10008.1.2.4.100.1", // MPEG2 Main Profile @ Main Level (retired)
    "1.2.840.10008.1.2.4.101", // MPEG2 Main Profile @ High Level
    "1.2.840.10008.1.2.4.101.1", // MPEG2 Main Profile @ High Level (retired)
    "1.2.840.10008.1.2.4.102", // MPEG-4 AVC/H.264 High Profile / Level 4.1
    "1.2.840.10008.1.2.4.102.1", // MPEG-4 AVC/H.264 High Profile / Level 4.1 (retired)
    "1.2.840.10008.1.2.4.103", // MPEG-4 AVC/H.264 BD-compatible High Profile / Level 4.1
    "1.2.840.10008.1.2.4.103.1", // MPEG-4 AVC/H.264 BD-compatible High Profile / Level 4.1 (retired)
    "1.2.840.10008.1.2.4.104", // MPEG-4 AVC/H.264 High Profile / Level 4.2 For 2D Video
    "1.2.840.10008.1.2.4.104.1", // MPEG-4 AVC/H.264 High Profile / Level 4.2 For 2D Video (retired)
    "1.2.840.10008.1.2.4.105", // MPEG-4 AVC/H.264 High Profile / Level 4.2 For 3D Video
    "1.2.840.10008.1.2.4.105.1", // MPEG-4 AVC/H.264 High Profile / Level 4.2 For 3D Video (retired)
    "1.2.840.10008.1.2.4.106", // MPEG-4 AVC/H.264 Stereo High Profile / Level 4.2
    "1.2.840.10008.1.2.4.106.1", // MPEG-4 AVC/H.264 Stereo High Profile / Level 4.2 (retired)
    "1.2.840.10008.1.2.4.107", // HEVC/H.265 Main Profile / Level 5.1
    "1.2.840.10008.1.2.4.108" // HEVC/H.265 Main 10 Profile / Level 5.1
]);

/**
 * Checks if a transfer syntax UID is a video transfer syntax
 * @param {string} uid - Transfer syntax UID to check
 * @returns {boolean} - True if the UID is a video transfer syntax
 */
export function isVideoTransferSyntax(uid) {
    return uid && videoTransferSyntaxUIDs.has(uid);
}

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
    DataSetTrailingPadding: "FFFCFFFC",
    StudyInstanceUID: "0020000D",
    SeriesInstanceUID: "0020000E",
    SOPInstanceUID: "00080018",
    TimezoneOffsetFromUTC: "00080201",
    AvailableTransferSyntaxUID: "00083002",
    MediaStorageSOPInstanceUID: "00020003"
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

/**
 * Maps DICOM tag hex strings to their normalized lower camelCase names
 * for use in listener.information tracking
 */
export const TAG_NAME_MAP = {
    "0020000D": "studyInstanceUid",
    "0020000E": "seriesInstanceUid",
    "00080018": "sopInstanceUid",
    "00020010": "transferSyntaxUid",
    "00083002": "availableTransferSyntaxUid",
    "00080201": "timezoneOffsetFromUtc",
    "00080005": "specificCharacterSet",
    "00280008": "numberOfFrames",
    "00280010": "rows",
    "00280011": "columns",
    "00280002": "samplesPerPixel",
    "00280100": "bitsAllocated",
    "00280103": "pixelRepresentation"
};

/**
 * Default tags to track in listener.information
 */
export const DEFAULT_INFORMATION_TAGS = new Set([
    "0020000D", // StudyInstanceUID
    "0020000E", // SeriesInstanceUID
    "00080018", // SOPInstanceUID
    "00020010", // TransferSyntaxUID
    "00083002", // AvailableTransferSyntaxUID
    "00080201", // TimezoneOffsetFromUTC
    "00080005", // SpecificCharacterSet
    "00280008", // NumberOfFrames
    "00280010", // Rows
    "00280011", // Columns
    "00280002", // SamplesPerPixel
    "00280100", // BitsAllocated
    "00280103" // PixelRepresentation
]);

/**
 * All valid DICOM VR (Value Representation) codes
 */
export const VALID_VRS = new Set([
    "AE", // Application Entity
    "AS", // Age String
    "AT", // Attribute Tag
    "CS", // Code String
    "DA", // Date
    "DS", // Decimal String
    "DT", // Date Time
    "FL", // Floating Point Single
    "FD", // Floating Point Double
    "IS", // Integer String
    "LO", // Long String
    "LT", // Long Text
    "OB", // Other Byte
    "OD", // Other Double
    "OF", // Other Float
    "OL", // Other Long
    "OV", // Other 64-bit Very Long
    "OW", // Other Word
    "PN", // Person Name
    "SH", // Short String
    "SL", // Signed Long
    "SQ", // Sequence of Items
    "SS", // Signed Short
    "ST", // Short Text
    "SV", // Signed 64-bit Very Long
    "TM", // Time
    "UC", // Unlimited Characters
    "UI", // Unique Identifier
    "UL", // Unsigned Long
    "UN", // Unknown
    "UR", // Universal Resource
    "US", // Unsigned Short
    "UT", // Unlimited Text
    "UV" // Unsigned 64-bit Very Long
]);

/**
 * DICOM VR (Value Representation) types that are allowed for bulkdata encoding
 * According to DICOMweb specification
 */
export const BULKDATA_VRS = new Set([
    "DS", // Decimal String
    "FL", // Floating Point Single
    "FD", // Floating Point Double
    "IS", // Integer String
    "LT", // Long Text
    "OB", // Other Byte
    "OD", // Other Double
    "OF", // Other Float
    "OL", // Other Long
    "OV", // Other 64-bit Very Long
    "OW", // Other Word
    "SL", // Signed Long
    "SS", // Signed Short
    "ST", // Short Text
    "SV", // Signed 64-bit Very Long
    "UC", // Unlimited Characters
    "UL", // Unsigned Long
    "UN", // Unknown
    "US", // Unsigned Short
    "UT", // Unlimited Text
    "UV" // Unsigned 64-bit Very Long
]);
