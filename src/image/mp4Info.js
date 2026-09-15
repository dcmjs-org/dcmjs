// src/image/mp4Info.js
//
// Minimal MP4 (ISO BMFF) header inspection: walk the box structure to recover
// the geometry and timing DICOM needs (Rows/Columns/NumberOfFrames/frame rate)
// and identify the matching video transfer syntax — WITHOUT decoding any
// pixels. H.264 in MP4 is a legal DICOM transfer syntax family (Supplement
// 225), so the MP4 stream can be carried as encapsulated PixelData verbatim;
// only the moov metadata must be understood.
//
// The moov box normally sits AFTER the (potentially enormous) mdat box, so the
// parser works against a random-access reader — { size, read(offset, length) }
// — and never buffers more than the moov box itself (a few MB even for a
// 20 GB file). Plain Uint8Array/ArrayBuffer input is wrapped in an in-memory
// reader so both call styles share one code path.

// Fragmentable MPEG-4 AVC/H.264 High Profile transfer syntaxes (Sup 225).
// The fragmentable ".1" family is always chosen because the encapsulation
// writer emits the stream as N >= 1 fragments.
const H264_HIGH_41_FRAGMENTABLE = "1.2.840.10008.1.2.4.102.1";
const H264_HIGH_42_FRAGMENTABLE = "1.2.840.10008.1.2.4.104.1";

// AVC profile_idc values that fit inside the "High Profile" transfer
// syntaxes: Baseline (66) and Main (77) are strict subsets of High (100).
const H264_SUPPORTED_PROFILES = new Set([66, 77, 100]);

/**
 * Map an AVC profile/level pair to the DICOM transfer syntax that carries it,
 * or null when no defined syntax fits (High-10/422/444 profiles, levels above
 * 4.2, HEVC, ...). level_idc is the H.264 level times ten (41 = Level 4.1).
 *
 * @param {number} profileIdc
 * @param {number} levelIdc
 * @returns {string|null}
 */
export function h264TransferSyntaxUID(profileIdc, levelIdc) {
    if (!H264_SUPPORTED_PROFILES.has(profileIdc)) {
        return null;
    }
    if (levelIdc <= 41) {
        return H264_HIGH_41_FRAGMENTABLE;
    }
    if (levelIdc === 42) {
        return H264_HIGH_42_FRAGMENTABLE;
    }
    return null;
}

/** Wrap in-memory bytes in the random-access reader contract. */
function memoryReader(input) {
    const bytes =
        input instanceof ArrayBuffer
            ? new Uint8Array(input)
            : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return {
        size: bytes.byteLength,
        read: (offset, length) =>
            Promise.resolve(bytes.subarray(offset, offset + length))
    };
}

function isReader(input) {
    return (
        input &&
        typeof input === "object" &&
        typeof input.read === "function" &&
        typeof input.size === "number"
    );
}

/** Big-endian readers over a Uint8Array (MP4 box fields are big-endian). */
function u16(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
}
function u32(bytes, offset) {
    return (
        (bytes[offset] * 0x1000000 +
            (bytes[offset + 1] << 16) +
            (bytes[offset + 2] << 8) +
            bytes[offset + 3]) >>>
        0
    );
}
function u64(bytes, offset) {
    // Box sizes and v1 durations: safe as a Number (files < 2^53 bytes).
    return u32(bytes, offset) * 0x100000000 + u32(bytes, offset + 4);
}
function fourCC(bytes, offset) {
    return String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3]
    );
}

/**
 * Iterate the child boxes of a byte range inside an in-memory buffer.
 * Yields { type, offset, size, headerLength } with offset relative to `bytes`.
 */
function* boxes(bytes, start, end) {
    let offset = start;
    while (offset + 8 <= end) {
        let size = u32(bytes, offset);
        const type = fourCC(bytes, offset + 4);
        let headerLength = 8;
        if (size === 1) {
            size = u64(bytes, offset + 8);
            headerLength = 16;
        } else if (size === 0) {
            size = end - offset;
        }
        if (size < headerLength || offset + size > end) {
            return; // malformed child; stop rather than walk garbage
        }
        yield { type, offset, size, headerLength };
        offset += size;
    }
}

function findBox(bytes, start, end, type) {
    for (const box of boxes(bytes, start, end)) {
        if (box.type === type) {
            return box;
        }
    }
    return null;
}

/**
 * Inspect an MP4 file and return what DICOM video encapsulation needs.
 *
 * @param {Uint8Array|ArrayBuffer|{size: number, read: (offset: number,
 *   length: number) => Promise<Uint8Array>}} input - the MP4 bytes, or a
 *   random-access reader over them (the streaming path for large files)
 * @returns {Promise<{ rows, columns, numberOfFrames, frameRate, cineRate,
 *   frameTime, codec, profileIdc, levelIdc, transferSyntaxUID: string|null,
 *   mp4ByteLength }>}
 * @throws on non-MP4 input or when no video track is present
 */
export async function parseMp4Info(input) {
    const reader = isReader(input) ? input : memoryReader(input);

    // Top-level scan: a handful of 16-byte header reads regardless of file
    // size. The first box must be ftyp — that is also the validity check.
    let offset = 0;
    let moovLocation = null;
    let first = true;
    while (offset + 8 <= reader.size) {
        const head = await reader.read(
            offset,
            Math.min(16, reader.size - offset)
        );
        let size = u32(head, 0);
        const type = fourCC(head, 4);
        if (size === 1) {
            if (head.byteLength < 16) {
                break;
            }
            size = u64(head, 8);
        } else if (size === 0) {
            size = reader.size - offset;
        }
        if (first && type !== "ftyp") {
            throw new Error(
                "parseMp4Info: input is not an MP4 file (missing ftyp box)"
            );
        }
        first = false;
        if (size < 8 || offset + size > reader.size) {
            throw new Error(
                `parseMp4Info: malformed box '${type}' at offset ${offset}`
            );
        }
        if (type === "moov") {
            moovLocation = { offset, size };
            break;
        }
        offset += size;
    }
    if (!moovLocation) {
        throw new Error(
            "parseMp4Info: no moov box found — truncated or still-recording MP4"
        );
    }

    // The moov box is metadata only (a few MB at most); buffer it whole.
    const moov = await reader.read(moovLocation.offset, moovLocation.size);

    // First trak whose handler is "vide".
    let video = null;
    for (const trak of boxes(moov, 8, moov.byteLength)) {
        if (trak.type !== "trak") {
            continue;
        }
        const trakEnd = trak.offset + trak.size;
        const mdia = findBox(moov, trak.offset + 8, trakEnd, "mdia");
        if (!mdia) {
            continue;
        }
        const mdiaEnd = mdia.offset + mdia.size;
        const hdlr = findBox(moov, mdia.offset + 8, mdiaEnd, "hdlr");
        // hdlr: 8 header + 4 version/flags + 4 pre_defined, then handler_type
        if (!hdlr || fourCC(moov, hdlr.offset + 16) !== "vide") {
            continue;
        }
        video = { mdia, mdiaEnd };
        break;
    }
    if (!video) {
        throw new Error(
            "parseMp4Info: no video track found in the MP4 (audio-only file?)"
        );
    }

    const { mdia, mdiaEnd } = video;

    // mdhd → timescale/duration (v0: 32-bit fields, v1: 64-bit times).
    const mdhd = findBox(moov, mdia.offset + 8, mdiaEnd, "mdhd");
    if (!mdhd) {
        throw new Error("parseMp4Info: video track has no mdhd box");
    }
    const mdhdVersion = moov[mdhd.offset + 8];
    let timescale, duration;
    if (mdhdVersion === 1) {
        timescale = u32(moov, mdhd.offset + 12 + 16);
        duration = u64(moov, mdhd.offset + 12 + 20);
    } else {
        timescale = u32(moov, mdhd.offset + 12 + 8);
        duration = u32(moov, mdhd.offset + 12 + 12);
    }

    const minf = findBox(moov, mdia.offset + 8, mdiaEnd, "minf");
    const stbl =
        minf && findBox(moov, minf.offset + 8, minf.offset + minf.size, "stbl");
    const stsd =
        stbl && findBox(moov, stbl.offset + 8, stbl.offset + stbl.size, "stsd");
    if (!stsd) {
        throw new Error("parseMp4Info: video track has no sample description");
    }
    const stblEnd = stbl.offset + stbl.size;

    // stsd: 8 header + 4 version/flags + 4 entry_count, then sample entries.
    const entry = stsd.offset + 16;
    const entrySize = u32(moov, entry);
    const codec = fourCC(moov, entry + 4);
    // VisualSampleEntry: 8 box header + 6 reserved + 2 data_reference_index
    // + 16 pre_defined/reserved → width at +32, height at +34 (validated
    // against real encoder output, not just the spec).
    const columns = u16(moov, entry + 32);
    const rows = u16(moov, entry + 34);

    // avcC → AVCDecoderConfigurationRecord: profile_idc and level_idc are
    // bytes 1 and 3 of the record. The fixed part of a VisualSampleEntry is
    // 86 bytes; codec-specific child boxes follow.
    let profileIdc = null;
    let levelIdc = null;
    if (codec === "avc1" || codec === "avc3") {
        const avcC = findBox(moov, entry + 86, entry + entrySize, "avcC");
        if (avcC) {
            profileIdc = moov[avcC.offset + 9];
            levelIdc = moov[avcC.offset + 11];
        }
    }

    // Frame count: stsz sample_count (authoritative), stts sum as fallback.
    let numberOfFrames = 0;
    const stsz = findBox(moov, stbl.offset + 8, stblEnd, "stsz");
    if (stsz) {
        numberOfFrames = u32(moov, stsz.offset + 16);
    }
    const stts = findBox(moov, stbl.offset + 8, stblEnd, "stts");
    if (!numberOfFrames && stts) {
        const entryCount = u32(moov, stts.offset + 12);
        for (let i = 0; i < entryCount; i++) {
            numberOfFrames += u32(moov, stts.offset + 16 + i * 8);
        }
    }

    // Frame rate: exact from a single-entry stts (constant frame rate);
    // otherwise the average over the track (variable frame rate).
    let frameRate = null;
    if (stts && u32(moov, stts.offset + 12) === 1) {
        const sampleDelta = u32(moov, stts.offset + 20);
        if (sampleDelta > 0) {
            frameRate = timescale / sampleDelta;
        }
    }
    if (!frameRate && duration > 0 && numberOfFrames > 0) {
        frameRate = (numberOfFrames * timescale) / duration;
    }
    if (!frameRate) {
        throw new Error(
            "parseMp4Info: could not determine the frame rate from the video track"
        );
    }

    return {
        rows,
        columns,
        numberOfFrames,
        frameRate,
        cineRate: Math.round(frameRate),
        // FrameTime (0018,1063) is DS: milliseconds per frame as a string.
        frameTime: (1000 / frameRate).toFixed(6),
        codec,
        profileIdc,
        levelIdc,
        transferSyntaxUID:
            profileIdc !== null
                ? h264TransferSyntaxUID(profileIdc, levelIdc)
                : null,
        mp4ByteLength: reader.size
    };
}
