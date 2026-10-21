// test/utils/makeTinyMp4.js
//
// Synthesizes a minimal-but-valid MP4 (ISO BMFF) in memory so the video
// tests need no committed binary fixture. The moov box carries a real video
// trak (hdlr "vide", mdhd, stsd with an avc1 VisualSampleEntry + avcC,
// stts, stsz), which is everything parseMp4Info reads; the mdat payload is
// deterministic pseudo-random bytes, NOT a decodable H.264 stream — fine,
// because encapsulation carries the stream verbatim and never decodes it.
//
// The default TOTAL file length is guaranteed ODD (a trailing odd-sized
// `free` box is appended when needed) so the encapsulation pad-byte path is
// exercised by every round-trip test.

function ascii(str) {
    return Array.from(str, c => c.charCodeAt(0));
}

function u16(value) {
    return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value) {
    return [
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff
    ];
}

/** A box: 32-bit size + fourCC + payload bytes. */
function box(type, ...payloads) {
    const payload = payloads.flat();
    return [...u32(8 + payload.length), ...ascii(type), ...payload];
}

/** Deterministic pseudo-random payload (xorshift; no Math.random). */
function payloadBytes(length, seed = 0x2545f491) {
    const bytes = new Uint8Array(length);
    let state = seed >>> 0;
    for (let i = 0; i < length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        bytes[i] = state & 0xff;
    }
    return bytes;
}

/**
 * @param {Object} [options]
 * @param {number} [options.mdatLength=1001] - payload byte count (odd by
 *   default, to exercise the encapsulation pad byte)
 * @param {number} [options.width=64]
 * @param {number} [options.height=48]
 * @param {number} [options.frames=12]
 * @param {number} [options.timescale=600]
 * @param {number} [options.sampleDelta=10] - 600/10 = 60 fps
 * @param {number} [options.profileIdc=100] - High
 * @param {number} [options.levelIdc=42] - Level 4.2 → 1.2.840.10008.1.2.4.104.1
 * @param {string} [options.codec="avc1"]
 * @param {boolean} [options.moovFirst=false] - moov before mdat (web-optimized
 *   layout) instead of the usual moov-at-end
 * @returns {Uint8Array} the MP4 file bytes
 */
export function makeTinyMp4(options = {}) {
    const {
        mdatLength = 1001,
        width = 64,
        height = 48,
        frames = 12,
        timescale = 600,
        sampleDelta = 10,
        profileIdc = 100,
        levelIdc = 42,
        codec = "avc1",
        moovFirst = false
    } = options;

    const duration = frames * sampleDelta;

    const ftyp = box("ftyp", ascii("isom"), u32(512), ascii("isomavc1"));

    // avcC: AVCDecoderConfigurationRecord — version, profile, compat, level,
    // then the NAL length-size byte and empty SPS/PPS counts.
    const avcC = box("avcC", [1, profileIdc, 0, levelIdc, 0xff, 0xe0, 0]);

    // avc1 VisualSampleEntry: 6 reserved + data_reference_index, 16
    // pre_defined/reserved, width/height, resolutions, reserved,
    // frame_count, 32-byte compressorname, depth, pre_defined; then avcC.
    const avc1 = box(
        codec,
        [0, 0, 0, 0, 0, 0],
        u16(1),
        new Array(16).fill(0),
        u16(width),
        u16(height),
        u32(0x00480000),
        u32(0x00480000),
        u32(0),
        u16(1),
        new Array(32).fill(0),
        u16(0x0018),
        u16(0xffff),
        avcC
    );

    const stsd = box("stsd", u32(0), u32(1), avc1);
    const stts = box("stts", u32(0), u32(1), u32(frames), u32(sampleDelta));
    // stsz with per-sample sizes (sample_size 0 → table follows).
    const sampleSize = Math.floor(mdatLength / frames) || 1;
    const stsz = box(
        "stsz",
        u32(0),
        u32(0),
        u32(frames),
        new Array(frames).fill(u32(sampleSize)).flat()
    );
    const stsc = box("stsc", u32(0), u32(1), u32(1), u32(frames), u32(1));
    const stco = box("stco", u32(0), u32(1), u32(0));
    const stbl = box("stbl", stsd, stts, stsc, stsz, stco);

    const dref = box(
        "dref",
        u32(0),
        u32(1),
        box("url ", u32(1)) // self-contained
    );
    const dinf = box("dinf", dref);
    const vmhd = box("vmhd", u32(1), new Array(8).fill(0));
    const minf = box("minf", vmhd, dinf, stbl);

    const hdlr = box(
        "hdlr",
        u32(0),
        u32(0),
        ascii("vide"),
        new Array(12).fill(0),
        ascii("Video\0")
    );
    const mdhd = box(
        "mdhd",
        u32(0), // version 0 + flags
        u32(0), // creation
        u32(0), // modification
        u32(timescale),
        u32(duration),
        u16(0x55c4), // language "und"
        u16(0)
    );
    const mdia = box("mdia", mdhd, hdlr, minf);

    const tkhd = box(
        "tkhd",
        u32(7), // version 0, flags: enabled/in-movie/in-preview
        u32(0),
        u32(0),
        u32(1), // track id
        u32(0),
        u32(duration),
        new Array(8).fill(0),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        // identity matrix
        u32(0x00010000),
        u32(0),
        u32(0),
        u32(0),
        u32(0x00010000),
        u32(0),
        u32(0),
        u32(0),
        u32(0x40000000),
        u32(width << 16),
        u32(height << 16)
    );
    const trak = box("trak", tkhd, mdia);

    const mvhd = box(
        "mvhd",
        u32(0),
        u32(0),
        u32(0),
        u32(timescale),
        u32(duration),
        u32(0x00010000), // rate 1.0
        u16(0x0100), // volume
        u16(0),
        u32(0),
        u32(0),
        // identity matrix
        u32(0x00010000),
        u32(0),
        u32(0),
        u32(0),
        u32(0x00010000),
        u32(0),
        u32(0),
        u32(0),
        u32(0x40000000),
        new Array(24).fill(0), // pre_defined
        u32(2) // next track id
    );
    const moov = box("moov", mvhd, trak);

    const payload = payloadBytes(mdatLength);
    const mdatHeader = [...u32(8 + mdatLength), ...ascii("mdat")];

    const parts = moovFirst
        ? [ftyp, moov, mdatHeader, payload]
        : [ftyp, mdatHeader, payload, moov];

    // Guarantee an odd TOTAL length so encapsulation always needs the pad
    // byte: append a minimal odd-sized free box when the sum lands even.
    const sum = parts.reduce(
        (n, part) => n + (part.length ?? part.byteLength),
        0
    );
    if (sum % 2 === 0) {
        parts.push([...u32(9), ...ascii("free"), 0]);
    }

    const total = parts.reduce(
        (n, part) => n + (part.length ?? part.byteLength),
        0
    );
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(
            part instanceof Uint8Array ? part : Uint8Array.from(part),
            offset
        );
        offset += part.length ?? part.byteLength;
    }
    return out;
}
