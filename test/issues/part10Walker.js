/**
 * Minimal Explicit VR Little Endian Part 10 byte walkers for the
 * issue-derived writer tests (test/issues/issue*.test.js).
 *
 * These deliberately re-parse writer OUTPUT with independent code (not the
 * library's own reader) so structural assertions - tag order, pad-byte
 * placement, fragment counts, SQ length encoding - are made against the
 * actual bytes, standing in for external consumers (pydicom, DCMTK,
 * dcm4che) that the upstream issues cite.
 *
 * Scope: Explicit VR Little Endian element headers only (all synthetic
 * fixtures in this suite are ELE or encapsulated-ELE). Undefined-length
 * elements are surfaced but not descended into except for encapsulated
 * pixel data items (parseEncapsulatedPixelData).
 */

const UNDEFINED_LENGTH = 0xffffffff;

// VRs using the 12-byte header (VR + 2 reserved + 32-bit length) in Explicit VR
const LENGTH32_VRS = new Set([
    "OB",
    "OW",
    "OF",
    "OD",
    "OL",
    "OV",
    "SQ",
    "UC",
    "UR",
    "UT",
    "UN",
    "SV",
    "UV"
]);

function toDataView(buffer) {
    if (buffer instanceof ArrayBuffer) {
        return new DataView(buffer);
    }
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/**
 * Offset of the first dataset element (after preamble, "DICM", the
 * (0002,0000) group length element, and the meta group itself).
 */
export function datasetStart(buffer) {
    const view = toDataView(buffer);
    const magic = String.fromCharCode(
        view.getUint8(128),
        view.getUint8(129),
        view.getUint8(130),
        view.getUint8(131)
    );
    if (magic !== "DICM") {
        throw new Error("part10Walker: no DICM magic at offset 128");
    }
    // (0002,0000) UL: tag(4) + VR(2) + len(2) + value(4)
    const metaLength = view.getUint32(140, true);
    return 144 + metaLength;
}

/** Reads one Explicit VR LE element header at `offset`. */
export function readElementHeader(view, offset) {
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);
    const tag = (
        group.toString(16).padStart(4, "0") +
        element.toString(16).padStart(4, "0")
    ).toUpperCase();
    const vr = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5)
    );
    let length, headerLength;
    if (LENGTH32_VRS.has(vr)) {
        length = view.getUint32(offset + 8, true);
        headerLength = 12;
    } else {
        length = view.getUint16(offset + 6, true);
        headerLength = 8;
    }
    return {
        tag,
        vr,
        length,
        headerLength,
        valueOffset: offset + headerLength
    };
}

/**
 * Walks the top-level dataset elements of an ELE Part 10 buffer,
 * returning [{ tag, vr, length, valueOffset }] in file order.
 * Stops (returns collected elements) at the first undefined-length
 * element it cannot structurally skip (undefined-length SQ items that
 * contain elements) - callers asserting tag order should use flat,
 * defined-length datasets or stop at that point.
 */
export function walkTopLevelElements(buffer) {
    const view = toDataView(buffer);
    const out = [];
    let offset = datasetStart(buffer);
    while (offset + 8 <= view.byteLength) {
        const el = readElementHeader(view, offset);
        out.push({
            tag: el.tag,
            vr: el.vr,
            length: el.length,
            valueOffset: el.valueOffset
        });
        if (el.length === UNDEFINED_LENGTH) {
            const next = trySkipUndefinedLength(view, el.valueOffset);
            if (next === null) {
                return out; // cannot skip structurally; stop here
            }
            offset = next;
        } else {
            offset = el.valueOffset + el.length;
        }
    }
    return out;
}

/**
 * Skips an undefined-length value made of (FFFE,E000) items with DEFINED
 * lengths (the encapsulated pixel data / defined-length item SQ shapes),
 * returning the offset just past the (FFFE,E0DD) delimiter, or null if a
 * non-delimiter or undefined-length item is encountered.
 */
function trySkipUndefinedLength(view, offset) {
    while (offset + 8 <= view.byteLength) {
        const group = view.getUint16(offset, true);
        const element = view.getUint16(offset + 2, true);
        const len = view.getUint32(offset + 4, true);
        offset += 8;
        if (group !== 0xfffe) {
            return null;
        }
        if (element === 0xe0dd) {
            return offset;
        }
        if (element !== 0xe000 || len === UNDEFINED_LENGTH) {
            return null;
        }
        offset += len;
    }
    return null;
}

/**
 * Walks top-level elements until `tagHex` (uppercase, e.g. "0040A730")
 * and returns its header info WITHOUT descending into its value.
 * Elements before it must have defined lengths.
 */
export function findElement(buffer, tagHex) {
    const view = toDataView(buffer);
    let offset = datasetStart(buffer);
    while (offset + 8 <= view.byteLength) {
        const el = readElementHeader(view, offset);
        if (el.tag === tagHex) {
            return el;
        }
        if (el.length === UNDEFINED_LENGTH) {
            const next = trySkipUndefinedLength(view, el.valueOffset);
            if (next === null) {
                throw new Error(
                    `part10Walker: cannot skip undefined-length ${el.tag} before ${tagHex}`
                );
            }
            offset = next;
        } else {
            offset = el.valueOffset + el.length;
        }
    }
    return null;
}

/**
 * Parses the encapsulated Pixel Data (7FE0,0010) element of an ELE Part 10
 * buffer into its Basic Offset Table and fragment items:
 *   { botEntryCount, botOffsets: number[],
 *     fragments: [{ length, offset, bytes: Uint8Array }] }
 * Throws if Pixel Data is missing or not undefined-length.
 */
export function parseEncapsulatedPixelData(buffer) {
    const view = toDataView(buffer);
    const el = findElement(buffer, "7FE00010");
    if (!el) {
        throw new Error("part10Walker: PixelData element not found");
    }
    if (el.length !== UNDEFINED_LENGTH) {
        throw new Error("part10Walker: PixelData is not encapsulated");
    }
    let offset = el.valueOffset;
    const items = [];
    for (;;) {
        if (offset + 8 > view.byteLength) {
            throw new Error("part10Walker: unterminated pixel data sequence");
        }
        const group = view.getUint16(offset, true);
        const element = view.getUint16(offset + 2, true);
        const len = view.getUint32(offset + 4, true);
        offset += 8;
        if (group !== 0xfffe) {
            throw new Error("part10Walker: invalid item tag in pixel data");
        }
        if (element === 0xe0dd) {
            break;
        }
        if (element !== 0xe000) {
            throw new Error("part10Walker: invalid item tag in pixel data");
        }
        items.push({
            length: len,
            offset,
            bytes: new Uint8Array(view.buffer, view.byteOffset + offset, len)
        });
        offset += len;
    }
    if (items.length === 0) {
        throw new Error("part10Walker: no items in pixel data sequence");
    }
    const bot = items[0];
    const botOffsets = [];
    for (let i = 0; i < bot.length; i += 4) {
        botOffsets.push(view.getUint32(bot.offset + i, true));
    }
    return {
        botEntryCount: bot.length / 4,
        botOffsets,
        fragments: items.slice(1)
    };
}

export { UNDEFINED_LENGTH };
