import { DicomMetaDictionary } from "./DicomMetaDictionary";
import { DicomDict } from "./DicomDict";

export function datasetToDict(dataset) {
    const fileMetaInformationVersionArray = new Uint8Array(2);
    fileMetaInformationVersionArray[1] = 1;

    const TransferSyntaxUID =
        dataset._meta.TransferSyntaxUID &&
        dataset._meta.TransferSyntaxUID.Value &&
        dataset._meta.TransferSyntaxUID.Value[0]
            ? dataset._meta.TransferSyntaxUID.Value[0]
            : "1.2.840.10008.1.2.1";

    dataset._meta = {
        MediaStorageSOPClassUID: dataset.SOPClassUID,
        MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
        ImplementationVersionName: "dcmjs-0.0",
        TransferSyntaxUID,
        ImplementationClassUID:
            "2.25.80302813137786398554742050926734630921603366648225212145404",
        FileMetaInformationVersion: fileMetaInformationVersionArray.buffer
    };

    const denaturalized = DicomMetaDictionary.denaturalizeDataset(
        dataset._meta
    );
    const dicomDict = new DicomDict(denaturalized);
    dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
    return dicomDict;
}

export function datasetToBuffer(dataset) {
    const source = datasetToDict(dataset).write();
    if (!Buffer?.from) {
        // Browsers don't natively have Buffer, although lots of apps use a polyfill
        return BufferFrom(source);
    }
    return Buffer.from(source);
}

export function datasetToBlob(dataset) {
    const buffer = datasetToBuffer(dataset);
    return new Blob([buffer], { type: "application/dicom" });
}

// There is no Buffer available generically in a browser, so this change
// implements one.

export function utf8ToBytes(str) {
    return new TextEncoder().encode(str);
}

export function base64ToBytes(str) {
    const binary = atob(str);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export function BufferFrom(value, encoding) {
    // Uint8Array
    if (value instanceof Uint8Array) {
        return value;
    }

    // ArrayBuffer
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value.slice(0));
    }

    // Array of numbers
    if (Array.isArray(value)) {
        return new Uint8Array(value);
    }

    // String
    if (typeof value === "string") {
        encoding = (encoding || "utf8").toLowerCase();

        if (encoding === "utf8" || encoding === "utf-8") {
            return utf8ToBytes(value);
        }

        if (encoding === "base64") {
            return base64ToBytes(value);
        }

        if (encoding === "hex") {
            const bytes = new Uint8Array(value.length / 2);
            for (let i = 0; i < bytes.length; i++) {
                bytes[i] = parseInt(value.substr(i * 2, 2), 16);
            }
            return bytes;
        }

        throw new Error("Unsupported encoding: " + encoding);
    }

    throw new TypeError("Unsupported type for Buffer.from");
}
