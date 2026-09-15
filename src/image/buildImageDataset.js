// src/image/buildImageDataset.js
//
// Build a full DICOM image instance from already-decoded pixels — the
// codec-free primitive behind DicomEventStream.fromImage. dcmjs deliberately
// ships no PNG/JPEG codecs (browser + node compatible); callers decode with
// whatever fits their environment (Canvas, pngjs, ...) and hand over pixels
// plus geometry. Like encapsulatePdf, this is a de novo builder returning a
// naturalized dataset ready for datasetToDict()/datasetToBuffer().
//
// The base context usually comes from a DICOMweb JSON metadata document (the
// forward-migration case: an image exported from an old DICOM file, traveling
// with its original metadata). Conformance rule for that case: the actual
// image geometry always wins over metadata claims, and a metadata document
// that identifies an original instance yields a DERIVED\SECONDARY instance
// with a fresh SOPInstanceUID — original UIDs are never reused for rebuilt
// pixel data.

import { DicomMetaDictionary } from "../DicomMetaDictionary.js";

const SECONDARY_CAPTURE_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.7";
const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";

// Attributes that must describe the actual pixels, never a metadata claim.
const GEOMETRY_KEYWORDS = [
    "Rows",
    "Columns",
    "SamplesPerPixel",
    "PhotometricInterpretation",
    "BitsAllocated",
    "BitsStored",
    "HighBit",
    "PixelRepresentation",
    "PlanarConfiguration",
    "NumberOfFrames",
    "PixelData"
];

// File meta (group 0002) keywords that leak in when callers naturalize a
// full instance document; the writer mints a fresh meta group instead.
const FILE_META_KEYWORDS = [
    "FileMetaInformationGroupLength",
    "FileMetaInformationVersion",
    "MediaStorageSOPClassUID",
    "MediaStorageSOPInstanceUID",
    "TransferSyntaxUID",
    "ImplementationClassUID",
    "ImplementationVersionName",
    "SourceApplicationEntityTitle"
];

const CONTROL_OPTIONS = ["metadata", "derivedFrom", "lossy", "encapsulated"];

/** Normalize ArrayBuffer | typed-array view to an exact ArrayBuffer. */
function toExactArrayBuffer(bytes, context) {
    if (bytes instanceof ArrayBuffer) {
        return bytes;
    }
    if (ArrayBuffer.isView(bytes)) {
        return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
        );
    }
    throw new Error(`${context}: expected an ArrayBuffer or typed array`);
}

/** True when the object looks like DICOM JSON: tag-keyed { vr, ... } entries. */
function isTagKeyed(metadata) {
    const keys = Object.keys(metadata);
    if (!keys.length) {
        return false;
    }
    return keys.some(
        key =>
            /^[0-9A-Fa-f]{8}$/.test(key) &&
            metadata[key] &&
            typeof metadata[key] === "object" &&
            typeof metadata[key].vr === "string"
    );
}

/**
 * Accept the base metadata in either DICOM JSON form (tag-keyed {vr,Value})
 * or naturalized keyword form; return a naturalized copy stripped of
 * everything the builder owns (geometry, pixel data, file meta, identity).
 */
function normalizeMetadata(metadata) {
    let naturalized;
    if (isTagKeyed(metadata)) {
        const tagEntries = {};
        for (const key of Object.keys(metadata)) {
            if (/^[0-9A-Fa-f]{8}$/.test(key)) {
                tagEntries[key.toUpperCase()] = metadata[key];
            }
        }
        naturalized = DicomMetaDictionary.naturalizeDataset(tagEntries);
    } else {
        naturalized = { ...metadata };
    }

    const source = {
        sopClassUID: naturalized.SOPClassUID,
        sopInstanceUID: naturalized.SOPInstanceUID
    };

    for (const keyword of [
        ...GEOMETRY_KEYWORDS,
        ...FILE_META_KEYWORDS,
        "SOPInstanceUID",
        "SpecificCharacterSet",
        "_meta",
        "_vrMap"
    ]) {
        delete naturalized[keyword];
    }
    // naturalizeDataset adds a _vrMap of its own on some inputs
    delete naturalized._vrMap;

    return { naturalized, source };
}

function resolveGeometry(decodedImage, encapsulated) {
    const { pixels, rows, columns } = decodedImage;

    if (!Number.isInteger(rows) || rows <= 0) {
        throw new Error("buildImageDataset: rows must be a positive integer");
    }
    if (!Number.isInteger(columns) || columns <= 0) {
        throw new Error(
            "buildImageDataset: columns must be a positive integer"
        );
    }

    const samplesPerPixel = decodedImage.samplesPerPixel || 1;
    const photometricInterpretation =
        decodedImage.photometricInterpretation ||
        (samplesPerPixel === 3 ? "RGB" : "MONOCHROME2");

    const monochrome = /^MONOCHROME[12]$/.test(photometricInterpretation);
    const color = /^(RGB|YBR_)/.test(photometricInterpretation);
    if (monochrome && samplesPerPixel !== 1) {
        throw new Error(
            `buildImageDataset: ${photometricInterpretation} requires ` +
                `samplesPerPixel 1, got ${samplesPerPixel}`
        );
    }
    if (color && samplesPerPixel !== 3) {
        throw new Error(
            `buildImageDataset: ${photometricInterpretation} requires ` +
                `samplesPerPixel 3, got ${samplesPerPixel}`
        );
    }

    let bitsAllocated = decodedImage.bitsAllocated;
    let pixelRepresentation = decodedImage.pixelRepresentation;
    if (!encapsulated) {
        if (!pixels || !ArrayBuffer.isView(pixels)) {
            throw new Error(
                "buildImageDataset: decodedImage.pixels must be a typed " +
                    "array (or pass options.encapsulated for pre-encoded frames)"
            );
        }
        const elementBits = pixels.BYTES_PER_ELEMENT * 8;
        if (bitsAllocated === undefined) {
            bitsAllocated = elementBits;
        } else if (bitsAllocated !== elementBits) {
            throw new Error(
                `buildImageDataset: bitsAllocated ${bitsAllocated} does not ` +
                    `match the ${elementBits}-bit typed array provided`
            );
        }
        if (pixelRepresentation === undefined) {
            pixelRepresentation =
                pixels instanceof Int8Array || pixels instanceof Int16Array
                    ? 1
                    : 0;
        }
    } else {
        bitsAllocated = bitsAllocated || 8;
        pixelRepresentation = pixelRepresentation || 0;
    }

    const bitsStored = decodedImage.bitsStored || bitsAllocated;
    const highBit =
        decodedImage.highBit === undefined
            ? bitsStored - 1
            : decodedImage.highBit;
    const numberOfFrames = decodedImage.numberOfFrames || 1;

    if (!encapsulated) {
        const expected =
            rows *
            columns *
            samplesPerPixel *
            numberOfFrames *
            (bitsAllocated / 8);
        if (pixels.byteLength !== expected) {
            throw new Error(
                `buildImageDataset: pixel buffer is ${pixels.byteLength} ` +
                    `bytes but ${rows}x${columns}x${samplesPerPixel}` +
                    `${
                        numberOfFrames > 1 ? `x${numberOfFrames} frames` : ""
                    } at ` +
                    `${bitsAllocated} bits needs ${expected} — fix the geometry ` +
                    `or the decode`
            );
        }
    }

    return {
        rows,
        columns,
        samplesPerPixel,
        photometricInterpretation,
        bitsAllocated,
        bitsStored,
        highBit,
        pixelRepresentation,
        planarConfiguration: decodedImage.planarConfiguration || 0,
        numberOfFrames
    };
}

/**
 * Build a naturalized DICOM image dataset from decoded pixels.
 *
 * Merge precedence (highest wins): actual image geometry -> UpperCamel
 * keyword overrides on `options` -> `options.metadata` (stripped of geometry
 * and identity) -> Secondary Capture defaults with freshly minted UIDs.
 *
 * Derivation: when `options.derivedFrom` is set, or `options.metadata`
 * carries a SOPInstanceUID, the result is marked as a derived instance:
 * fresh SOPInstanceUID, ImageType DERIVED\SECONDARY, SourceImageSequence
 * referencing the original, LossyImageCompression "01" (pass
 * `lossy: false` for a lossless derivation, or `{ method, ratio }` detail).
 *
 * @param {Object} decodedImage
 * @param {Uint8Array|Int8Array|Uint16Array|Int16Array} [decodedImage.pixels]
 *   interleaved decoded samples; required unless options.encapsulated
 * @param {number} decodedImage.rows
 * @param {number} decodedImage.columns
 * @param {number} [decodedImage.samplesPerPixel=1]
 * @param {string} [decodedImage.photometricInterpretation] MONOCHROME2 / RGB default
 * @param {number} [decodedImage.bitsAllocated] from the typed array width
 * @param {number} [decodedImage.bitsStored=bitsAllocated]
 * @param {number} [decodedImage.highBit=bitsStored-1]
 * @param {number} [decodedImage.pixelRepresentation] 1 for signed arrays
 * @param {number} [decodedImage.planarConfiguration=0]
 * @param {number} [decodedImage.numberOfFrames=1]
 * @param {Object} [options] control keys (metadata, derivedFrom, lossy,
 *   encapsulated) plus UpperCamel DICOM keyword overrides (PatientName, ...)
 * @returns {Object} naturalized dataset with _meta and _vrMap
 */
function buildImageDataset(decodedImage = {}, options = {}) {
    if (decodedImage.pixels && options.encapsulated) {
        throw new Error(
            "buildImageDataset: pass either decodedImage.pixels or " +
                "options.encapsulated, not both"
        );
    }

    const geometry = resolveGeometry(decodedImage, options.encapsulated);

    const { naturalized: base, source } = options.metadata
        ? normalizeMetadata(options.metadata)
        : { naturalized: {}, source: {} };

    // Keyword overrides: everything UpperCamel that is not a control option.
    const overrides = {};
    for (const key of Object.keys(options)) {
        if (CONTROL_OPTIONS.includes(key)) {
            continue;
        }
        if (GEOMETRY_KEYWORDS.includes(key)) {
            throw new Error(
                `buildImageDataset: ${key} comes from the decoded image and ` +
                    `cannot be overridden — fix decodedImage instead`
            );
        }
        overrides[key] = options[key];
    }

    // Derivation source: explicit derivedFrom wins over metadata identity.
    let derivation = null;
    if (options.derivedFrom === true || source.sopInstanceUID) {
        derivation = {
            sopClassUID: source.sopClassUID,
            sopInstanceUID: source.sopInstanceUID
        };
    }
    if (options.derivedFrom && typeof options.derivedFrom === "object") {
        derivation = {
            sopClassUID: options.derivedFrom.sopClassUID,
            sopInstanceUID: options.derivedFrom.sopInstanceUID
        };
    }

    const date = DicomMetaDictionary.date();
    const time = DicomMetaDictionary.time();

    const dataset = {
        // Base context first; scaffold fills the gaps; overrides win.
        ...base,

        SpecificCharacterSet: "ISO_IR 192",
        SOPClassUID:
            base.SOPClassUID ||
            derivation?.sopClassUID ||
            SECONDARY_CAPTURE_SOP_CLASS_UID,

        StudyInstanceUID: base.StudyInstanceUID || DicomMetaDictionary.uid(),
        StudyDate: base.StudyDate || date,
        StudyTime: base.StudyTime || time,
        ReferringPhysicianName: base.ReferringPhysicianName ?? "",
        StudyID: base.StudyID ?? "",
        AccessionNumber: base.AccessionNumber ?? "",

        PatientName: base.PatientName ?? "",
        PatientID: base.PatientID ?? "",
        PatientBirthDate: base.PatientBirthDate ?? "",
        PatientSex: base.PatientSex ?? "",

        Modality: base.Modality || "OT",
        SeriesInstanceUID: base.SeriesInstanceUID || DicomMetaDictionary.uid(),
        SeriesNumber: base.SeriesNumber ?? 1,

        InstanceNumber: base.InstanceNumber ?? 1,
        ContentDate: base.ContentDate || date,
        ContentTime: base.ContentTime || time,

        ...overrides,

        // The builder's own attributes: identity, derivation, geometry.
        SOPInstanceUID: overrides.SOPInstanceUID || DicomMetaDictionary.uid(),

        Rows: geometry.rows,
        Columns: geometry.columns,
        SamplesPerPixel: geometry.samplesPerPixel,
        PhotometricInterpretation: geometry.photometricInterpretation,
        BitsAllocated: geometry.bitsAllocated,
        BitsStored: geometry.bitsStored,
        HighBit: geometry.highBit,
        PixelRepresentation: geometry.pixelRepresentation,

        _meta: {
            TransferSyntaxUID: {
                Value: [
                    options.encapsulated
                        ? options.encapsulated.transferSyntaxUID
                        : EXPLICIT_LITTLE_ENDIAN
                ]
            }
        },
        _vrMap: {
            PixelData: geometry.bitsAllocated === 16 ? "OW" : "OB"
        }
    };

    if (geometry.samplesPerPixel > 1) {
        dataset.PlanarConfiguration = geometry.planarConfiguration;
    }
    if (geometry.numberOfFrames > 1) {
        dataset.NumberOfFrames = geometry.numberOfFrames;
    }

    if (options.encapsulated) {
        if (
            !options.encapsulated.transferSyntaxUID ||
            !Array.isArray(options.encapsulated.frames) ||
            !options.encapsulated.frames.length
        ) {
            throw new Error(
                "buildImageDataset: options.encapsulated needs " +
                    "{ transferSyntaxUID, frames: [bytes, ...] }"
            );
        }
        dataset.PixelData = options.encapsulated.frames.map(frame =>
            toExactArrayBuffer(frame, "buildImageDataset encapsulated frame")
        );
        dataset._vrMap.PixelData = "OB";
    } else {
        dataset.PixelData = toExactArrayBuffer(
            decodedImage.pixels,
            "buildImageDataset pixels"
        );
    }

    if (derivation) {
        if (!overrides.ImageType) {
            dataset.ImageType = ["DERIVED", "SECONDARY"];
        }
        if (derivation.sopClassUID && derivation.sopInstanceUID) {
            dataset.SourceImageSequence = [
                {
                    ReferencedSOPClassUID: derivation.sopClassUID,
                    ReferencedSOPInstanceUID: derivation.sopInstanceUID
                }
            ];
        }
        if (options.lossy === false) {
            dataset.LossyImageCompression = "00";
        } else {
            dataset.LossyImageCompression = "01";
            if (options.lossy && typeof options.lossy === "object") {
                if (options.lossy.method) {
                    dataset.LossyImageCompressionMethod = options.lossy.method;
                }
                if (options.lossy.ratio) {
                    dataset.LossyImageCompressionRatio = options.lossy.ratio;
                }
            }
        }
    } else if (!overrides.ImageType && !base.ImageType) {
        dataset.ImageType = ["ORIGINAL", "PRIMARY"];
    }

    // SC Equipment module only where it belongs.
    if (dataset.SOPClassUID === SECONDARY_CAPTURE_SOP_CLASS_UID) {
        dataset.ConversionType = dataset.ConversionType || "WSD";
        dataset.Manufacturer = dataset.Manufacturer || "dcmjs";
    }

    return dataset;
}

export { buildImageDataset, SECONDARY_CAPTURE_SOP_CLASS_UID };
