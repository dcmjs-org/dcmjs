// packages/imaging/src/derivedImageAttributes.js
//
// The attributes that mark an image as derived from other images, and the
// base block that adds them to a composition.

import { log } from "@dcmjs-org/core";

const REQUIRED_KEYS = ["SOPClassUID", "SOPInstanceUID"];

/** True when a source says that it was lossy compressed ("01"). */
function isLossySource(source) {
    return [].concat(source.LossyImageCompression).includes("01");
}

/** The derivedFrom list; an empty list throws. */
function sourceList(derivedFrom, caller) {
    const sources = [].concat(derivedFrom ?? []);
    if (!sources.length) {
        throw new Error(`${caller}: derivedFrom needs at least one instance`);
    }
    return sources;
}

/** The values of a multi-valued attribute as a list, without empty values. */
function valueList(value) {
    return [].concat(value ?? []).filter(item => item !== "" && item !== null);
}

/** One value as itself, several values as an array, none as undefined. */
function multiValue(values) {
    return values.length > 1 ? values : values[0];
}

/**
 * The attributes of an image that is derived from other images. The function
 * returns only these attributes; it does not change any input.
 *
 * - `ImageType`: `["DERIVED", "SECONDARY"]`.
 * - `SourceImageSequence`: one item for each `derivedFrom` instance, in
 *   order, with `ReferencedSOPClassUID` and `ReferencedSOPInstanceUID`.
 * - `LossyImageCompression`: `"01"` by default, `"00"` for `lossy: false`.
 *   When a source has `"01"`, the result is `"01"` also for `lossy: false`,
 *   because a lossy image stays lossy (PS3.3 C.7.6.1.1.5).
 * - `LossyImageCompressionMethod` and `LossyImageCompressionRatio`: the
 *   values of each lossy source, in `derivedFrom` order, then `method` and
 *   `ratio` of a `lossy` object (PS3.3 C.7.6.1.1.5 keeps every lossy step).
 *   One value is a plain value; more values are an array. When the
 *   number of ratios differs from the number of methods, the result has no
 *   ratio, and the function logs a warning.
 *
 * Each `derivedFrom` item is a naturalized instance, full or partial. It must
 * have `SOPClassUID` and `SOPInstanceUID`; the function throws an error that
 * names a missing keyword. An empty `derivedFrom` throws.
 *
 * @param {Object|Object[]} derivedFrom - the source instance(s), at least one
 * @param {Object} [options]
 * @param {boolean|{method: string, ratio: number}} [options.lossy=true]
 * @returns {Object} the derived-image attributes
 */
export function derivedImageAttributes(derivedFrom, { lossy } = {}) {
    const sources = sourceList(derivedFrom, "derivedImageAttributes");
    const SourceImageSequence = sources.map((source, index) => {
        const missing = REQUIRED_KEYS.filter(key => !source?.[key]);
        if (missing.length) {
            throw new Error(
                `derivedImageAttributes: derivedFrom[${index}] is missing ` +
                    `${missing.join(" and ")}; each derivedFrom instance ` +
                    `needs SOPClassUID and SOPInstanceUID`
            );
        }
        return {
            ReferencedSOPClassUID: source.SOPClassUID,
            ReferencedSOPInstanceUID: source.SOPInstanceUID
        };
    });

    const lossySources = sources.filter(isLossySource);
    const lossless = lossy === false && !lossySources.length;
    const attributes = {
        ImageType: ["DERIVED", "SECONDARY"],
        SourceImageSequence,
        LossyImageCompression: lossless ? "00" : "01"
    };
    const detail = lossy && typeof lossy === "object" ? lossy : {};
    const methods = lossySources.flatMap(source =>
        valueList(source.LossyImageCompressionMethod)
    );
    const ratios = lossySources.flatMap(source =>
        valueList(source.LossyImageCompressionRatio)
    );
    methods.push(...valueList(detail.method));
    ratios.push(...valueList(detail.ratio));
    if (methods.length) {
        attributes.LossyImageCompressionMethod = multiValue(methods);
    }
    if (ratios.length === methods.length) {
        if (ratios.length) {
            attributes.LossyImageCompressionRatio = multiValue(ratios);
        }
    } else if (ratios.length) {
        log.warn(
            `derivedImageAttributes: ${methods.length} lossy method(s) and ` +
                `${ratios.length} ratio(s) do not pair; the result has no ` +
                `LossyImageCompressionRatio`
        );
    }
    return attributes;
}

/**
 * A base block that adds {@link derivedImageAttributes} to a composition, in
 * the same shape as `nextSeriesNumberBase`. Put it after the block that sets
 * the default `ImageType` (`secondaryCaptureImageBase`), so that the derived
 * `ImageType` replaces the default. `buildImageDataset` adds it for
 * `derivedFrom`; a caller can also add it to a custom `baseDicom`. An empty
 * `derivedFrom` throws when the block is made.
 *
 * @param {Object|Object[]} derivedFrom - the source instance(s), at least one
 * @param {Object} [options]
 * @param {boolean|{method: string, ratio: number}} [options.lossy=true]
 * @returns {Function} a base block
 */
export function derivedImageBase(derivedFrom, { lossy } = {}) {
    const sources = sourceList(derivedFrom, "derivedImageBase");
    return () => derivedImageAttributes(sources, { lossy });
}
