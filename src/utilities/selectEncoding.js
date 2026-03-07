import {
    defaultDICOMEncoding,
    defaultEncoding,
    encodingMapping
} from "../constants/encodings";
import { log } from "./log";

export function selectDICOMEncoding(values, ignoreErrors = false) {
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
    if (
        !dicomEncoding ||
        typeof dicomEncoding !== "string" ||
        dicomEncoding.length === 0
    ) {
        return defaultEncoding;
    }

    // if we get something like "iso-ir-13\iso-ir-166", make sure we select "iso-ir-13". Unit tests already test for this.
    const sanitizedEncoding = dicomEncoding.split("\\").at(0).trim();
    // if we get something like "ISO_IR 166", we sanitize to "iso-ir-166". Unit tests already test for this.
    const coding = sanitizedEncoding.replace(/[_ ]/g, "-").toLowerCase();
    if (encodingMapping.has(coding)) {
        return encodingMapping.get(coding);
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
