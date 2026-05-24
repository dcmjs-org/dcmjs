import { PADDING_NULL, PADDING_SPACE } from "./dicom";

export const padBytes = new Map([
    ["AT", PADDING_NULL],
    ["FL", PADDING_NULL],
    ["FD", PADDING_NULL],
    ["SL", PADDING_NULL],
    ["SQ", PADDING_NULL],
    ["SS", PADDING_NULL],
    ["US", PADDING_NULL],
    ["UL", PADDING_NULL],
    ["UI", PADDING_NULL],
    ["UN", PADDING_NULL],
    ["OW", PADDING_NULL],
    ["OB", PADDING_NULL],
    ["OD", PADDING_NULL],
    ["OF", PADDING_NULL],
    ["AE", PADDING_SPACE],
    ["CS", PADDING_SPACE],
    ["AS", PADDING_SPACE],
    ["DA", PADDING_SPACE],
    ["DS", PADDING_SPACE],
    ["DT", PADDING_SPACE],
    ["IS", PADDING_SPACE],
    ["LO", PADDING_SPACE],
    ["LT", PADDING_SPACE],
    ["PN", PADDING_SPACE],
    ["SH", PADDING_SPACE],
    ["ST", PADDING_SPACE],
    ["TM", PADDING_SPACE],
    ["UC", PADDING_SPACE],
    ["UT", PADDING_SPACE],
    ["UR", PADDING_SPACE]
]);

export const defaultPadding = null;
