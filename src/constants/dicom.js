// TransferSyntaxUIDs
export const IMPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2";
export const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";
export const DEFLATED_EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1.99";
export const EXPLICIT_BIG_ENDIAN = "1.2.840.10008.1.2.2";

// Data Element Length
export const UNDEFINED_LENGTH = 0xffffffff;
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

/**
 * This is an enumeration of some HEX values for the tag strings, used to replace
 * constants in a few places.
 */
export const TagHex = {
    Item: "FFFEE000",
    ItemDelimitationEnd: "FFFEE00D",
    SequenceDelimitationEnd: "FFFEE0DD",
    PixelData: "7FE00010"
};
