import {
    defaultDICOMEncoding,
    defaultEncoding,
    encodingMapping
} from "../constants/encodings";
import { log } from "./log";

export function selectEncoding(values, ignoreErrors = false) {
    if (!values || !Array.isArray(values)) {
        return defaultDICOMEncoding; // default encoding
    }

    switch (values.length) {
        case 0:
            return defaultDICOMEncoding; // default encoding
        case 1:
            return values[0];
        default:
            if (!ignoreErrors) {
                throw Error(
                    `Using multiple character sets is not supported: ${values}`
                );
            }

            // Fallthrough to warn and select first encoding
            log.warn(
                "Using multiple character sets is not supported, proceeding with just the first character set",
                values
            );
            return values[0];
    }
}

// Translates the DICOM specified encoding into a Web or native encoding target
// so we can use decoding APIs to correctly handle DICOM buffers.
export function selectNativeEncoding(dicomEncoding, ignoreErrors = false) {
    const coding = dicomEncoding.replace(/[_ ]/g, "-").toLowerCase();
    if (encodingMapping.has(coding)) {
        return encodingMapping[coding];
    } else if (ignoreErrors) {
        log.warn(
            `Unsupported character set: ${coding}, using default 
                character set ${defaultEncoding}`
        );
    } else {
        throw Error(`Unsupported character set: ${coding}`);
    }
    return defaultEncoding;
}
