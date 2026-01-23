import { TagHex } from "../src/constants/dicom.js";

/**
 * DICOM meta dict for video transfer syntax test
 * This contains the file meta information (group 0002)
 * Pixel data fragments are added separately in the test
 */
export const videoTestMeta = {
    [TagHex.TransferSyntaxUID]: {
        vr: "UI",
        Value: ["1.2.840.10008.1.2.4.102"] // MPEG-4 AVC/H.264 High Profile / Level 4.1
    },
    [TagHex.MediaStorageSOPInstanceUID]: {
        vr: "UI",
        Value: ["1.2.3.4.5.6.7.8.9"]
    },
    [TagHex.MediaStorageSOPClassUID]: {
        vr: "UI",
        Value: ["1.2.840.10008.5.1.4.1.1.1"] // CR Image Storage
    }
};

/**
 * DICOM dataset dict for video transfer syntax test
 * This contains the dataset elements (group 0008+)
 */
export const videoTestDict = {
    [TagHex.Rows]: {
        vr: "US",
        Value: [512]
    },
    [TagHex.Columns]: {
        vr: "US",
        Value: [512]
    },
    [TagHex.NumberOfFrames]: {
        vr: "IS",
        Value: ["137"]
    }
};
