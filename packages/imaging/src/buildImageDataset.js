// packages/imaging/src/buildImageDataset.js
//
// Build a full DICOM image instance from already-decoded pixels — the
// codec-free image primitive of dcmjs. dcmjs deliberately ships no PNG/JPEG
// codecs (browser + node compatible); callers decode with whatever fits
// their environment (Canvas, pngjs, ...) and hand over pixels plus
// geometry. Like encapsulate, this builds on createInstance and takes
// the same options (attributes in `overrides`, a naturalized DICOM
// provider), and returns a naturalized dataset ready for
// datasetToDict()/datasetToBuffer().

import {
    combineBases,
    createInstance,
    defaultInstanceBase,
    EXPLICIT_LITTLE_ENDIAN,
    predecessorBase
} from "@dcmjs-org/core";
import { derivedImageBase } from "./derivedImageAttributes.js";

const SECONDARY_CAPTURE_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.7";

/**
 * Secondary Capture identity, the default `ImageType` (ORIGINAL\PRIMARY),
 * the SC Equipment `ConversionType` (WSD, workstation), and the Image module
 * content date and time.
 */
function secondaryCaptureImageBase(context) {
    return {
        SOPClassUID: SECONDARY_CAPTURE_SOP_CLASS_UID,
        Modality: "OT",
        ConversionType: "WSD",
        ImageType: ["ORIGINAL", "PRIMARY"],
        ContentDate: context.date,
        ContentTime: context.time
    };
}

/**
 * The default base of `buildImageDataset`: core instance defaults, the
 * Secondary Capture block, and `predecessorBase` (for `predecessor: true`).
 * Use `.items` to build a variant.
 */
const imageBase = combineBases(
    defaultInstanceBase,
    secondaryCaptureImageBase,
    predecessorBase
);

// The decodedImage field of each geometry keyword (IMG-USR-2).
const GEOMETRY_FIELDS = {
    Rows: "rows",
    Columns: "columns",
    SamplesPerPixel: "samplesPerPixel",
    PhotometricInterpretation: "photometricInterpretation",
    BitsAllocated: "bitsAllocated",
    BitsStored: "bitsStored",
    HighBit: "highBit",
    PixelRepresentation: "pixelRepresentation",
    PlanarConfiguration: "planarConfiguration",
    NumberOfFrames: "numberOfFrames"
};

const isPresent = value =>
    value !== undefined && value !== null && value !== "";

/** The single value of a naturalized attribute, or undefined when empty. */
function singleValue(value) {
    const single = Array.isArray(value) ? value[0] : value;
    return isPresent(single) ? single : undefined;
}

/**
 * Normalize a typed-array view to an exact ArrayBuffer. Another value is
 * returned as it is; the function does not check the type (CORE-IMP-11).
 */
function toExactArrayBuffer(bytes) {
    if (ArrayBuffer.isView(bytes)) {
        return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
        );
    }
    return bytes;
}

/**
 * The geometry that the decoded input gives (IMG-USR-2): each explicit
 * `decodedImage` field, plus the values that the payload determines.
 * `BitsAllocated` comes from the typed-array width of `pixels`,
 * `PixelRepresentation` 1 from a signed typed array, and `NumberOfFrames`
 * from `encapsulated.frames.length`. Without `decodedImage.highBit`, a
 * decoded `bitsStored` gives `HighBit` = `bitsStored` - 1. The result has no
 * key for a value that the decoded input does not give: the builder
 * calculates no other value.
 */
function decodedGeometry(decodedImage, encapsulated) {
    const geometry = {};
    for (const [keyword, field] of Object.entries(GEOMETRY_FIELDS)) {
        if (isPresent(decodedImage[field])) {
            geometry[keyword] = decodedImage[field];
        }
    }
    if (geometry.HighBit === undefined && geometry.BitsStored !== undefined) {
        geometry.HighBit = geometry.BitsStored - 1;
    }
    const { pixels } = decodedImage;
    if (!encapsulated) {
        // The typed array gives BitsAllocated and PixelRepresentation, so
        // a float array would write integer pixels (IMG-USR-9).
        if (pixels instanceof Float32Array || pixels instanceof Float64Array) {
            throw new Error(
                `buildImageDataset: decodedImage.pixels is a ` +
                    `${pixels.constructor.name}; DICOM integer pixel data ` +
                    `needs an integer typed array`
            );
        }
        const elementBits = pixels.BYTES_PER_ELEMENT * 8;
        if (
            geometry.BitsAllocated !== undefined &&
            geometry.BitsAllocated !== elementBits
        ) {
            throw new Error(
                `buildImageDataset: bitsAllocated ${geometry.BitsAllocated} ` +
                    `does not match the ${elementBits}-bit typed array provided`
            );
        }
        geometry.BitsAllocated = elementBits;
        if (
            geometry.PixelRepresentation === undefined &&
            (pixels instanceof Int8Array ||
                pixels instanceof Int16Array ||
                pixels instanceof Int32Array)
        ) {
            geometry.PixelRepresentation = 1;
        }
    } else {
        // The fragment list is the ground truth for the frame count. An
        // explicit count that disagrees hides frames (review finding 10).
        const frameCount = encapsulated.frames.length;
        if (
            geometry.NumberOfFrames !== undefined &&
            geometry.NumberOfFrames !== frameCount
        ) {
            throw new Error(
                `buildImageDataset: decodedImage.numberOfFrames ` +
                    `(${geometry.NumberOfFrames}) does not match ` +
                    `options.encapsulated.frames.length (${frameCount})`
            );
        }
        geometry.NumberOfFrames = frameCount;
    }
    return geometry;
}

/**
 * The requirement checks of IMG-USR-9 on the effective values: the decoded
 * value, else the value of `dataset` (base, inherited, or override).
 * `Rows` and `Columns` must be positive integers, so one of the two sources
 * must give them. For another absent value, the check uses the old default
 * only inside the computation, and does not write it: `SamplesPerPixel` 1
 * and `NumberOfFrames` 1. The photometric check needs a
 * `PhotometricInterpretation`.
 */
function checkGeometry(geometry, dataset, pixels) {
    const effective = keyword =>
        geometry[keyword] !== undefined
            ? geometry[keyword]
            : singleValue(dataset[keyword]);
    for (const keyword of ["Rows", "Columns"]) {
        const value = effective(keyword);
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(
                `buildImageDataset: ${keyword} must be a positive integer ` +
                    `(decodedImage.${GEOMETRY_FIELDS[keyword]}, or the ` +
                    `merged dataset), got ${value}`
            );
        }
    }
    const samplesPerPixel = effective("SamplesPerPixel") ?? 1;
    const photometricInterpretation = effective("PhotometricInterpretation");

    if (photometricInterpretation !== undefined) {
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
    }

    if (!pixels) {
        return;
    }
    const rows = effective("Rows");
    const columns = effective("Columns");
    const numberOfFrames = effective("NumberOfFrames") ?? 1;
    // Native pixels always give BitsAllocated (decodedGeometry).
    const bitsAllocated = geometry.BitsAllocated;
    const expected =
        rows * columns * samplesPerPixel * numberOfFrames * (bitsAllocated / 8);
    if (pixels.byteLength !== expected) {
        throw new Error(
            `buildImageDataset: pixel buffer is ${pixels.byteLength} ` +
                `bytes but ${rows}x${columns}x${samplesPerPixel}` +
                `${numberOfFrames > 1 ? `x${numberOfFrames} frames` : ""} at ` +
                `${bitsAllocated} bits needs ${expected} — fix the geometry ` +
                `or the decode`
        );
    }
}

/**
 * Build a naturalized DICOM image dataset from decoded pixels with
 * {@link createInstance}, then set the pixel data.
 *
 * The options follow CORE-USR-1 (`packages/core/README.md`); the image rules
 * are IMG-USR-n in `packages/imaging/README.md`. The options object holds
 * the controls; the DICOM attributes go in `options.overrides`, a
 * naturalized DICOM provider with the forms of `baseDicom`. An extra option
 * key has no effect (CORE-USR-7). With `dataLevel: "series"`, `instance` is
 * the sample instance in the series (CORE-USR-5).
 *
 * For a non-empty `derivedFrom`, the base is
 * `combineBases(baseDicom, derivedImageBase(derivedFrom, { lossy }))`
 * (IMG-IMP-1). The builder removes its control keys `derivedFrom`, `lossy`,
 * and `encapsulated` before the call (CORE-IMP-9). After the call, it
 * checks the effective geometry (IMG-USR-9), writes only the geometry that
 * the decoded input gives (IMG-USR-2), and sets the pixel encoding and
 * `PixelData`.
 *
 * @example
 * buildImageDataset(decodedImage, {
 *     instance,
 *     derivedFrom: source,
 *     overrides: { SeriesDescription: "Thumbnail" }
 * });
 *
 * @param {Object} decodedImage - the decoded pixels and geometry. Each
 *   geometry field has no default. A field that is not given writes
 *   nothing, and the value of the base, `instance`, or `overrides` stays.
 * @param {Uint8Array|Int8Array|Uint16Array|Int16Array} [decodedImage.pixels]
 *   interleaved decoded samples in an integer typed array; required unless
 *   options.encapsulated
 * @param {number} [decodedImage.rows] else the merged `Rows`
 * @param {number} [decodedImage.columns] else the merged `Columns`
 * @param {number} [decodedImage.samplesPerPixel]
 * @param {string} [decodedImage.photometricInterpretation]
 * @param {number} [decodedImage.bitsAllocated] must match the typed-array
 *   width of `pixels`, which always gives `BitsAllocated`
 * @param {number} [decodedImage.bitsStored]
 * @param {number} [decodedImage.highBit] else `bitsStored` - 1 when
 *   `decodedImage.bitsStored` is given
 * @param {number} [decodedImage.pixelRepresentation] else 1 for a signed
 *   typed array
 * @param {number} [decodedImage.planarConfiguration] written only when the
 *   effective `SamplesPerPixel` is more than 1
 * @param {number} [decodedImage.numberOfFrames] must match
 *   `encapsulated.frames.length`, which always gives `NumberOfFrames`
 * @param {Object} [options] - the {@link createInstance} options
 *   (`instance`, `dataLevel`, `levels`, `predecessor`, `postProcess`,
 *   `overrides`), plus:
 * @param {*} [options.baseDicom=imageBase] - base blocks
 * @param {Object|Object[]} [options.derivedFrom] - the naturalized
 *   instance(s) that the image is derived from; each needs SOPClassUID and
 *   SOPInstanceUID. An empty array is the same as no `derivedFrom`.
 * @param {boolean|{method: string, ratio: number}} [options.lossy=true] -
 *   the lossy compression of a derivation; no effect without `derivedFrom`
 * @param {{transferSyntaxUID: string, frames: Array}} [options.encapsulated]
 *   - pre-encoded frames and their transfer syntax, in place of pixels
 * @returns {Object} naturalized dataset with _meta and _vrMap
 */
function buildImageDataset(decodedImage = {}, options = {}) {
    const {
        baseDicom = imageBase,
        derivedFrom,
        lossy,
        encapsulated,
        ...rest
    } = options;
    if (decodedImage.pixels && encapsulated) {
        throw new Error(
            "buildImageDataset: pass either decodedImage.pixels or " +
                "options.encapsulated, not both"
        );
    }

    // The transfer syntax and the frames are used below (IMG-USR-9).
    if (
        encapsulated &&
        (!encapsulated.transferSyntaxUID || !encapsulated.frames?.length)
    ) {
        throw new Error(
            "buildImageDataset: options.encapsulated needs " +
                "{ transferSyntaxUID, frames: [bytes, ...] }"
        );
    }

    const geometry = decodedGeometry(decodedImage, encapsulated);

    const sources = [].concat(derivedFrom ?? []);
    const dataset = createInstance({
        ...rest,
        baseDicom: sources.length
            ? combineBases(baseDicom, derivedImageBase(sources, { lossy }))
            : baseDicom
    });
    checkGeometry(geometry, dataset, !encapsulated && decodedImage.pixels);

    // A decoded value replaces the base, inherited, or override value. A
    // value that the decoded input does not give stays (IMG-USR-2).
    const { PlanarConfiguration, NumberOfFrames, ...always } = geometry;
    Object.assign(dataset, always);
    if (
        PlanarConfiguration !== undefined &&
        singleValue(dataset.SamplesPerPixel) > 1
    ) {
        dataset.PlanarConfiguration = PlanarConfiguration;
    }
    // A single-frame IOD has no NumberOfFrames, so a frame count of 1 from
    // frames.length is written only to replace an existing value.
    if (
        NumberOfFrames !== undefined &&
        (NumberOfFrames > 1 ||
            isPresent(decodedImage.numberOfFrames) ||
            isPresent(dataset.NumberOfFrames))
    ) {
        dataset.NumberOfFrames = NumberOfFrames;
    }
    // Encapsulated pixel data is always OB (PS3.5 A.4).
    dataset._vrMap = {
        ...(dataset._vrMap || {}),
        PixelData:
            !encapsulated && singleValue(dataset.BitsAllocated) === 16
                ? "OW"
                : "OB"
    };
    // instanceBase supplies Explicit VR Little Endian; set the transfer
    // syntax only for encapsulated frames, or when the merged _meta has no
    // transfer syntax. The copy keeps overrides._meta of the caller
    // unchanged (CORE-USR-13).
    const hasTransferSyntax = Boolean(dataset._meta?.TransferSyntaxUID);
    dataset._meta = { ...(dataset._meta || {}) };
    if (encapsulated || !hasTransferSyntax) {
        dataset._meta.TransferSyntaxUID = {
            Value: [
                encapsulated
                    ? encapsulated.transferSyntaxUID
                    : EXPLICIT_LITTLE_ENDIAN
            ]
        };
    }

    dataset.PixelData = encapsulated
        ? encapsulated.frames.map(frame => toExactArrayBuffer(frame))
        : toExactArrayBuffer(decodedImage.pixels);

    return dataset;
}

export {
    buildImageDataset,
    imageBase,
    secondaryCaptureImageBase,
    SECONDARY_CAPTURE_SOP_CLASS_UID
};
