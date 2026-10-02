// src/media/directoryOffsets.js
//
// Byte-offset computation for DICOMDIR directory records.
//
// The load-bearing fact: every DICOMDIR offset attribute (0004,1200/1202/
// 1400/1420) is VR UL — a fixed four-byte value — so the values NEVER affect
// the byte layout. One measurement pass over the exact structures the final
// write will serialize (same writer, same options, placeholder zeros)
// therefore yields the exact offsets of the final file, and the file is
// written once with the real values filled in.
//
// Layout being measured (mirrors DicomDict.write):
//   128-byte preamble + "DICM"
//   FileMetaInformationGroupLength element
//   meta group (Explicit VR Little Endian)
//   body tags below (0004,1220), sorted ascending
//   (0004,1220) DirectoryRecordSequence: 12-byte SQ header (undefined
//     length), then per item: 8-byte item header (FFFE,E000, undefined
//     length) + item body + 8-byte item delimiter (FFFE,E00D) — see
//     SequenceOfItems.writeBytes — and a trailing 8-byte sequence delimiter.
//
// A directory-record offset points at the FFFE,E000 item tag of that record,
// counted from byte 0 of the file (PS3.10 8.6).

import { WriteBufferStream } from "../BufferStream.js";
import { DicomMessage } from "../DicomMessage.js";
import { EXPLICIT_LITTLE_ENDIAN, TagHex } from "../constants/dicom.js";

const DIRECTORY_RECORD_SEQUENCE = "00041220";

const ITEM_HEADER_BYTES = 8; // FFFE,E000 + 4-byte undefined length
const ITEM_DELIMITER_BYTES = 8; // FFFE,E00D + 4-byte zero length

/** Bytes DicomMessage.write produces for one tag-keyed object. */
function measure(jsonObject, writeOptions) {
    const stream = new WriteBufferStream(1024);
    DicomMessage.write(
        jsonObject,
        stream,
        EXPLICIT_LITTLE_ENDIAN,
        writeOptions
    );
    return stream.size;
}

/**
 * Compute the absolute byte offset of every directory record item in the
 * file `dicomDict.write(writeOptions)` will produce. Call with the offsets
 * still zero; patch the returned values in, then write — the layout is
 * guaranteed identical because offsets are fixed-width.
 *
 * @param {import("../DicomDict.js").DicomDict} dicomDict - denaturalized
 *   DICOMDIR ({ meta, dict }) whose dict contains (0004,1220)
 * @param {Object} writeOptions - the SAME object later passed to write()
 * @returns {number[]} byte offset of each record's item tag, in item order
 */
export function computeDirectoryOffsets(dicomDict, writeOptions) {
    // Preamble + magic.
    let cursor = 128 + 4;

    // FileMetaInformationGroupLength + meta group. The group length element
    // is measured with the real meta size as its value — UL again, so the
    // element size is value-independent, but measuring keeps zero assumptions.
    const metaSize = measure(dicomDict.meta, writeOptions);
    const groupLengthStream = new WriteBufferStream(64);
    DicomMessage.writeTagObject(
        groupLengthStream,
        TagHex.FileMetaInformationGroupLength,
        "UL",
        metaSize,
        EXPLICIT_LITTLE_ENDIAN,
        writeOptions
    );
    cursor += groupLengthStream.size + metaSize;

    // Body tags before the record sequence, in the writer's sorted order.
    const bodyTags = Object.keys(dicomDict.dict).sort();
    for (const tag of bodyTags) {
        if (tag >= DIRECTORY_RECORD_SEQUENCE) {
            break;
        }
        cursor += measure({ [tag]: dicomDict.dict[tag] }, writeOptions);
    }

    // SQ element header: measure an empty sequence (header + 8-byte
    // sequence delimiter) rather than assuming the 12-byte constant.
    const sequence = dicomDict.dict[DIRECTORY_RECORD_SEQUENCE];
    const emptySequenceSize = measure(
        { [DIRECTORY_RECORD_SEQUENCE]: { vr: "SQ", Value: [] } },
        writeOptions
    );
    cursor += emptySequenceSize - ITEM_DELIMITER_BYTES;

    const offsets = [];
    const items = (sequence && sequence.Value) || [];
    for (const item of items) {
        offsets.push(cursor);
        cursor +=
            ITEM_HEADER_BYTES +
            measure(item, writeOptions) +
            ITEM_DELIMITER_BYTES;
    }

    return offsets;
}
