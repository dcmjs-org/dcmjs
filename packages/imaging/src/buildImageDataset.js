// src/image/buildImageDataset.js
//
// Build a full DICOM image instance from already-decoded pixels — the
// codec-free primitive behind DicomEventStream.fromImage. dcmjs deliberately
// ships no PNG/JPEG codecs (browser + node compatible); callers decode with
// whatever fits their environment (Canvas, pngjs, ...) and hand over pixels
// plus geometry. Like encapsulate, this builds on createInstance and takes
// the same options, and returns a naturalized dataset ready for
// datasetToDict()/datasetToBuffer().

import {
    combineBases,
    createInstance,
    defaultInstanceBase,
    EXPLICIT_LITTLE_ENDIAN,
    log,
    predecessorBase
} from "@dcmjs-org/core";
import { derivedImageBase } from "./derivedImageAttributes.js";

const SECONDARY_CAPTURE_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.7";

/**
 * Secondary Capture identity, the default `ImageType` (ORIGINAL\PRIMARY),
 * and the Image module content date and time.
 */
function secondaryCaptureImageBase(context) {
    return {
        SOPClassUID: SECONDARY_CAPTURE_SOP_CLASS_UID,
        Modality: "OT",
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

// Attributes that must describe the actual pixels, never another source.
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
    // In encapsulated mode the fragment list is the ground truth for the
    // frame count: default to frames.length, and reject an explicit claim
    // that disagrees — an instance whose NumberOfFrames does not match its
    // fragments hides frames from conformant readers (review finding 10).
    let numberOfFrames = decodedImage.numberOfFrames;
    if (encapsulated && Array.isArray(encapsulated.frames)) {
        const frameCount = encapsulated.frames.length;
        if (numberOfFrames === undefined) {
            numberOfFrames = frameCount || 1;
        } else if (numberOfFrames !== frameCount) {
            throw new Error(
                `buildImageDataset: decodedImage.numberOfFrames ` +
                    `(${numberOfFrames}) does not match ` +
                    `options.encapsulated.frames.length (${frameCount})`
            );
        }
    } else {
        numberOfFrames = numberOfFrames || 1;
    }

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
 * Build a naturalized DICOM image dataset from decoded pixels with
 * {@link createInstance}, then set the pixel data.
 *
 * The options follow CORE-USR-1 (`packages/core/README.md`); the image rules
 * are IMG-USR-n in `packages/imaging/README.md`. With `dataLevel: "series"`,
 * `instance` is the prior instance in the series (CORE-USR-5).
 *
 * For a non-empty `derivedFrom`, the base is
 * `combineBases(baseDicom, derivedImageBase(derivedFrom, { lossy }))`, so
 * the merge stays base < inherited < overrides. The builder removes its
 * control keys `derivedFrom`, `lossy`, and `encapsulated` before the call
 * (CORE-IMP-9). The geometry and the pixel encoding are set last; an
 * override of a geometry keyword throws.
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
 * @param {Object} [options] - the {@link createInstance} options, plus:
 * @param {*} [options.baseDicom=imageBase] - base blocks
 * @param {Object|Object[]} [options.derivedFrom] - the naturalized
 *   instance(s) that the image is derived from; each needs SOPClassUID and
 *   SOPInstanceUID. An empty array is the same as no `derivedFrom`.
 * @param {boolean|{method: string, ratio: number}} [options.lossy=true] -
 *   the lossy compression of a derivation (only with `derivedFrom`)
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

    const geometry = resolveGeometry(decodedImage, encapsulated);

    // An undefined option keeps the base or inherited value.
    for (const key of GEOMETRY_KEYWORDS) {
        if (rest[key] !== undefined) {
            throw new Error(
                `buildImageDataset: ${key} comes from the decoded image and ` +
                    `cannot be overridden — fix decodedImage instead`
            );
        }
    }

    const sources = [].concat(derivedFrom ?? []);
    if (!sources.length && lossy !== undefined) {
        log.warn(
            "buildImageDataset: lossy applies only with derivedFrom, and " +
                "is ignored"
        );
    }
    const created = createInstance({
        ...rest,
        baseDicom: sources.length
            ? combineBases(baseDicom, derivedImageBase(sources, { lossy }))
            : baseDicom
    });
    for (const key of GEOMETRY_KEYWORDS) {
        delete created[key];
    }

    // The builder's own attributes win: geometry and encoding.
    const dataset = Object.assign(created, {
        Rows: geometry.rows,
        Columns: geometry.columns,
        SamplesPerPixel: geometry.samplesPerPixel,
        PhotometricInterpretation: geometry.photometricInterpretation,
        BitsAllocated: geometry.bitsAllocated,
        BitsStored: geometry.bitsStored,
        HighBit: geometry.highBit,
        PixelRepresentation: geometry.pixelRepresentation,

        _vrMap: {
            ...(created._vrMap || {}),
            PixelData: geometry.bitsAllocated === 16 ? "OW" : "OB"
        }
    });
    // instanceBase supplies Explicit VR Little Endian; set _meta only for
    // encapsulated frames, or when a custom base has no _meta.
    if (encapsulated || !dataset._meta) {
        dataset._meta = {
            ...(dataset._meta || {}),
            TransferSyntaxUID: {
                Value: [
                    encapsulated
                        ? encapsulated.transferSyntaxUID
                        : EXPLICIT_LITTLE_ENDIAN
                ]
            }
        };
    }

    if (geometry.samplesPerPixel > 1) {
        dataset.PlanarConfiguration = geometry.planarConfiguration;
    }
    if (geometry.numberOfFrames > 1) {
        dataset.NumberOfFrames = geometry.numberOfFrames;
    }

    if (encapsulated) {
        if (
            !encapsulated.transferSyntaxUID ||
            !Array.isArray(encapsulated.frames) ||
            !encapsulated.frames.length
        ) {
            throw new Error(
                "buildImageDataset: options.encapsulated needs " +
                    "{ transferSyntaxUID, frames: [bytes, ...] }"
            );
        }
        dataset.PixelData = encapsulated.frames.map(frame =>
            toExactArrayBuffer(frame, "buildImageDataset encapsulated frame")
        );
        dataset._vrMap.PixelData = "OB";
    } else {
        dataset.PixelData = toExactArrayBuffer(
            decodedImage.pixels,
            "buildImageDataset pixels"
        );
    }

    // SC Equipment module only where it belongs.
    if (dataset.SOPClassUID === SECONDARY_CAPTURE_SOP_CLASS_UID) {
        dataset.ConversionType = dataset.ConversionType || "WSD";
    }

    return dataset;
}

export {
    buildImageDataset,
    imageBase,
    secondaryCaptureImageBase,
    SECONDARY_CAPTURE_SOP_CLASS_UID
};
