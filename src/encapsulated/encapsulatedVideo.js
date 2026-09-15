// src/encapsulated/encapsulatedVideo.js
//
// Video encapsulation (Supplement 225): an MP4's H.264 stream travels inside
// a Video Photographic Image instance VERBATIM — the pixel data fragments are
// consecutive byte ranges of the one MP4 stream, so extraction is
// concatenation and the round trip is byte-identical. Two directions,
// mirroring encapsulatedPdf.js:
//
//   buildVideoDataset(mp4Info, options) — dataset shell (no PixelData), used
//       by both the buffered and the streaming encapsulation paths.
//   encapsulateVideo(mp4Bytes, options) — MP4 in (buffered): dataset plus
//       PixelData as fragment-sized ArrayBuffer slices.
//   extractEncapsulatedVideo(dataset)   — MP4 out: recover the stream from a
//       naturalized video instance, truncated to the declared total length.
//
// The (7FE0,0003) Encapsulated Pixel Data Value Total Length element (VR UV,
// uint64) records the exact stream length so the required trailing pad byte
// on an odd-length final fragment can be dropped on extraction.

import { DicomMetaDictionary } from "../DicomMetaDictionary.js";
import { isVideoTransferSyntax } from "../constants/dicom.js";
import { parseMp4Info } from "../image/mp4Info.js";

const VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.77.1.4.1";

// 256 MiB: small enough that one in-flight fragment stays comfortably in
// memory, large enough that a 21.8 GB stream is only ~82 fragments.
const DEFAULT_FRAGMENT_BYTES = 256 * 1024 * 1024;

/**
 * Validate/default the encapsulation fragment size. Fragment item lengths are
 * 32-bit and must be even (PS3.5 §A.4), so the size must be an even integer
 * below 2^32-2.
 *
 * @param {number} [fragmentBytes]
 * @returns {number}
 */
function normalizeFragmentBytes(fragmentBytes) {
    if (fragmentBytes === undefined || fragmentBytes === null) {
        return DEFAULT_FRAGMENT_BYTES;
    }
    if (
        !Number.isInteger(fragmentBytes) ||
        fragmentBytes < 2 ||
        fragmentBytes % 2 !== 0 ||
        fragmentBytes >= 0xfffffffe
    ) {
        throw new Error(
            `fragmentBytes must be an even integer between 2 and 2^32-2 ` +
                `(fragment item lengths are even 32-bit values); got ${fragmentBytes}`
        );
    }
    return fragmentBytes;
}

/** The corrective error for codecs no DICOM video transfer syntax carries. */
function unsupportedCodecError(info) {
    const profile =
        info.profileIdc !== null
            ? ` profile ${info.profileIdc} level ${(info.levelIdc / 10).toFixed(
                  1
              )}`
            : "";
    return new Error(
        `unsupported video codec '${info.codec}'${profile} — DICOM video ` +
            "encapsulation supports H.264 Baseline/Main/High up to Level 4.2. " +
            "Transcode first, e.g.: ffmpeg -i in.mp4 -c:v libx264 " +
            "-profile:v high -level 4.2 -c:a copy out.mp4"
    );
}

/**
 * Build the naturalized dataset shell for a Video Photographic Image
 * instance — everything except PixelData, which the caller supplies either
 * buffered (encapsulateVideo) or as a fragment event stream (fromVideo).
 *
 * Element list mirrors the Supplement 225 reference fixture: XC modality,
 * CineRate/FrameTime from the measured frame rate, YBR_PARTIAL_420 8-bit
 * geometry, LossyImageCompression 01, and the (7FE0,0003) total length as a
 * BigInt (VR UV is a uint64). Every UID defaults to a freshly minted one;
 * pass StudyInstanceUID/SeriesInstanceUID to attach into an existing study.
 *
 * @param {Object} mp4Info - parseMp4Info result
 * @param {Object} [options] - naturalized keyword overrides (PatientName,
 *   PatientID, StudyInstanceUID, ...)
 * @returns {Object} naturalized dataset with _meta/_vrMap, no PixelData
 */
function buildVideoDataset(mp4Info, options = {}) {
    if (!mp4Info.transferSyntaxUID) {
        throw unsupportedCodecError(mp4Info);
    }

    const date = DicomMetaDictionary.date();
    const time = DicomMetaDictionary.time();

    const dataset = {
        // SOP Common
        SpecificCharacterSet: "ISO_IR 192",
        SOPClassUID: VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
        SOPInstanceUID: options.SOPInstanceUID || DicomMetaDictionary.uid(),

        // General Study (Type 2 attributes always present)
        StudyInstanceUID: options.StudyInstanceUID || DicomMetaDictionary.uid(),
        StudyDate: options.StudyDate || date,
        StudyTime: options.StudyTime || time,
        ReferringPhysicianName: options.ReferringPhysicianName || "",
        StudyID: options.StudyID || "1",
        AccessionNumber: options.AccessionNumber || "",

        // Patient
        PatientName: options.PatientName || "",
        PatientID: options.PatientID || "",
        PatientBirthDate: options.PatientBirthDate || "",
        PatientSex: options.PatientSex || "",

        // Series
        Modality: "XC",
        SeriesInstanceUID:
            options.SeriesInstanceUID || DicomMetaDictionary.uid(),
        SeriesNumber: options.SeriesNumber || 1,

        // Cine
        CineRate: mp4Info.cineRate,
        FrameTime: mp4Info.frameTime,

        // Image Pixel — the values every MPEG-4 AVC transfer syntax mandates
        // (PS3.5 §8.2.6): the stream itself carries the real subsampling.
        InstanceNumber: options.InstanceNumber || 1,
        SamplesPerPixel: 3,
        PhotometricInterpretation: "YBR_PARTIAL_420",
        PlanarConfiguration: 0,
        NumberOfFrames: mp4Info.numberOfFrames,
        Rows: mp4Info.rows,
        Columns: mp4Info.columns,
        BitsAllocated: 8,
        BitsStored: 8,
        HighBit: 7,
        PixelRepresentation: 0,
        LossyImageCompression: "01",

        // Exact stream length, excluding the trailing pad byte on an
        // odd-length final fragment (Sup 225). UV is a uint64 → BigInt.
        EncapsulatedPixelDataValueTotalLength: BigInt(mp4Info.mp4ByteLength),

        _meta: {
            TransferSyntaxUID: {
                Value: [mp4Info.transferSyntaxUID]
            }
        },
        _vrMap: {
            PixelData: "OB"
        }
    };

    if (options.SeriesDescription) {
        dataset.SeriesDescription = options.SeriesDescription;
    }
    if (options.StudyDescription) {
        dataset.StudyDescription = options.StudyDescription;
    }

    return dataset;
}

/**
 * Wrap MP4 bytes into a naturalized video instance, buffered: PixelData is an
 * array of fragment-sized ArrayBuffer slices ready for datasetToDict /
 * datasetToBuffer. For files too large to buffer, use
 * DicomEventStream.fromVideoStream instead.
 *
 * @param {ArrayBuffer|Uint8Array} mp4Bytes
 * @param {Object} [options] - buildVideoDataset overrides + { fragmentBytes }
 * @returns {Promise<Object>} naturalized dataset
 */
async function encapsulateVideo(mp4Bytes, options = {}) {
    const bytes =
        mp4Bytes instanceof ArrayBuffer
            ? new Uint8Array(mp4Bytes)
            : new Uint8Array(
                  mp4Bytes.buffer,
                  mp4Bytes.byteOffset,
                  mp4Bytes.byteLength
              );
    const info = await parseMp4Info(bytes);
    const dataset = buildVideoDataset(info, options);
    const fragmentBytes = normalizeFragmentBytes(options.fragmentBytes);

    const fragments = [];
    for (let offset = 0; offset < bytes.byteLength; offset += fragmentBytes) {
        const end = Math.min(offset + fragmentBytes, bytes.byteLength);
        // slice() so each fragment is an exact, unshared ArrayBuffer.
        fragments.push(
            bytes.buffer.slice(
                bytes.byteOffset + offset,
                bytes.byteOffset + end
            )
        );
    }
    dataset.PixelData = fragments;
    return dataset;
}

/** Unwrap one naturalized binary payload to fragments of Uint8Array. */
function toFragmentList(payload) {
    if (payload === undefined || payload === null) {
        return [];
    }
    // The event-stream naturalizer wraps binary as { InlineBinary } (an
    // ArrayBuffer, a view, a base64 string, or an array of fragments).
    if (
        typeof payload === "object" &&
        !(payload instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(payload) &&
        !Array.isArray(payload) &&
        payload.InlineBinary !== undefined
    ) {
        payload = payload.InlineBinary;
    }
    const list = Array.isArray(payload) ? payload : [payload];
    return list.map(fragment => {
        if (typeof fragment === "string") {
            const binary = atob(fragment);
            const decoded = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                decoded[i] = binary.charCodeAt(i);
            }
            return decoded;
        }
        if (
            fragment &&
            typeof fragment === "object" &&
            !(fragment instanceof ArrayBuffer) &&
            !ArrayBuffer.isView(fragment) &&
            fragment.InlineBinary !== undefined
        ) {
            return toFragmentList(fragment)[0];
        }
        return ArrayBuffer.isView(fragment)
            ? new Uint8Array(
                  fragment.buffer,
                  fragment.byteOffset,
                  fragment.byteLength
              )
            : new Uint8Array(fragment);
    });
}

/** The meta transfer syntax of a naturalized dataset, tolerant of shape. */
function metaTransferSyntax(dataset) {
    const meta = dataset._meta;
    if (!meta) {
        return undefined;
    }
    const entry = meta.TransferSyntaxUID || meta["00020010"];
    if (!entry) {
        return undefined;
    }
    if (typeof entry === "string") {
        return entry;
    }
    return Array.isArray(entry.Value) ? entry.Value[0] : entry.Value;
}

/**
 * Recover the verbatim video stream from a naturalized video instance.
 *
 * Fragments are concatenated and the result truncated to the declared
 * (7FE0,0003) total length, which drops the pad byte a Part 10 writer adds
 * to an odd-length final fragment. When the element is absent (older
 * producers), nothing is trimmed and `declaredLength` is null so the caller
 * can decide how loudly to warn.
 *
 * @param {Object} dataset - naturalized video instance
 * @returns {{ bytes: Uint8Array, transferSyntaxUID: string|undefined,
 *   declaredLength: number|null }}
 */
function extractEncapsulatedVideo(dataset) {
    const transferSyntaxUID = metaTransferSyntax(dataset);
    const isVideo =
        dataset.SOPClassUID === VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID ||
        isVideoTransferSyntax(transferSyntaxUID);
    if (!isVideo || dataset.PixelData === undefined) {
        throw new Error(
            "extractEncapsulatedVideo: dataset is not an encapsulated video " +
                "instance (expected SOP Class " +
                VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID +
                " or a video transfer syntax, with PixelData). " +
                (transferSyntaxUID
                    ? `Found transfer syntax ${transferSyntaxUID}. `
                    : "") +
                "For an Encapsulated PDF use toPdf(); for pixel images use " +
                "toNaturalized()/toPart10()."
        );
    }

    const fragments = toFragmentList(dataset.PixelData);
    const total = fragments.reduce((n, f) => n + f.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const fragment of fragments) {
        out.set(fragment, offset);
        offset += fragment.byteLength;
    }

    const declared = dataset.EncapsulatedPixelDataValueTotalLength;
    const declaredLength =
        declared === undefined || declared === null
            ? null
            : Number(Array.isArray(declared) ? declared[0] : declared);

    const bytes =
        declaredLength !== null && declaredLength <= out.byteLength
            ? out.subarray(0, declaredLength)
            : out;

    return { bytes, transferSyntaxUID, declaredLength };
}

export {
    buildVideoDataset,
    encapsulateVideo,
    extractEncapsulatedVideo,
    normalizeFragmentBytes,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES
};
