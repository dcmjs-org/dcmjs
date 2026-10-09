import pako from "pako";
import { Tag } from "../Tag.js";
import { ValueRepresentation } from "../ValueRepresentation.js";
import { deepEqual } from "../utilities/deepEqual.js";
import { WriteBufferStream } from "../BufferStream.js";
import {
    DEFLATED_EXPLICIT_LITTLE_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    TagHex
} from "../constants/dicom.js";

/**
 * The dataset/element write primitives, relocated verbatim from
 * DicomMessage.write / writeTagObject / _getTagWriteValues (whose statics now
 * delegate here) so the streaming writer and the eager writer share one
 * implementation without the generator package importing @dcmjs-org/legacy.
 *
 * Everything these functions touch is core's: Tag.write drives the element
 * encoding through ValueRepresentation, and deepEqual backs the
 * _rawValue-vs-Value fidelity check. Tag and ValueRepresentation are only
 * dereferenced at call time, per the circular-import discipline of the wider
 * codebase (ValueRepresentation's sequence writer calls back into
 * writeDataSet for its items).
 */

/**
 * Relocated from DicomMessage._getTagWriteValues: write _rawValue back
 * unformatted when the formatted original still equals Value (the value was
 * never touched), otherwise write the edited Value.
 */
export function getTagWriteValues(vrType, tagObject) {
    if (!tagObject._rawValue) {
        return tagObject.Value;
    }

    // apply VR specific formatting to the original _rawValue and compare to the Value
    const vr = ValueRepresentation.createByTypeString(vrType);

    let originalValue;
    if (Array.isArray(tagObject._rawValue)) {
        originalValue = tagObject._rawValue.map(val => vr.applyFormatting(val));
    } else {
        originalValue = vr.applyFormatting(tagObject._rawValue);
    }

    // if Value has not changed, write _rawValue unformatted back into the file
    if (deepEqual(tagObject.Value, originalValue)) {
        return tagObject._rawValue;
    } else {
        return tagObject.Value;
    }
}

/** Relocated from DicomMessage.writeTagObject. */
export function writeTagObject(
    stream,
    tagString,
    vr,
    values,
    syntax,
    writeOptions
) {
    var tag = Tag.fromString(tagString);

    tag.write(stream, vr, values, syntax, writeOptions);
}

/** Relocated from DicomMessage.write: one tag-keyed object, sorted tag order. */
export function writeDataSet(jsonObjects, useStream, syntax, writeOptions) {
    var written = 0;

    var sortedTags = Object.keys(jsonObjects).sort();
    sortedTags.forEach(function (tagString) {
        var tag = Tag.fromString(tagString),
            tagObject = jsonObjects[tagString],
            vrType = tagObject.vr;

        var values = getTagWriteValues(vrType, tagObject);

        written += tag.write(useStream, vrType, values, syntax, writeOptions);
    });

    return written;
}

// Wire the sequence writer's item callback (ValueRepresentation's
// SequenceOfItems serializes each item through writeDataSet). Registration
// rather than an import in ValueRepresentation.js keeps the two files free
// of a module-level cycle; see setWriteDataSet for the seam's contract.
ValueRepresentation.setWriteDataSet(writeDataSet);

/**
 * The full DICOM Part 10 envelope, relocated verbatim from legacy
 * DicomDict.write() (which now delegates here): 128-byte preamble + "DICM",
 * the meta group written explicit little endian with a computed
 * FileMetaInformationGroupLength, then the dataset in the meta-declared
 * transfer syntax — including the deflate-on-write branch (W4) for
 * 1.2.840.10008.1.2.1.99. Padding and Big16 handling live below this in
 * Tag.write / ValueRepresentation, which are core's already.
 *
 * Matching the original's semantics, a missing TransferSyntaxUID is
 * defaulted to explicit little endian by mutating the passed `meta` object.
 *
 * @param {{meta: Object, dict: Object}} dataSet tag-keyed meta and dataset
 * @param {Object} [writeOptions]
 * @returns {ArrayBuffer}
 */
export function writePart10(
    { meta, dict },
    writeOptions = { allowInvalidVRLength: false }
) {
    var metaSyntax = EXPLICIT_LITTLE_ENDIAN;
    var fileStream = new WriteBufferStream(4096, true);
    fileStream.writeUint8Repeat(0, 128);
    fileStream.writeAsciiString("DICM");

    var metaStream = new WriteBufferStream(1024);
    if (!meta[TagHex.TransferSyntaxUID]) {
        meta[TagHex.TransferSyntaxUID] = {
            vr: "UI",
            Value: [EXPLICIT_LITTLE_ENDIAN]
        };
    }
    writeDataSet(meta, metaStream, metaSyntax, writeOptions);
    writeTagObject(
        fileStream,
        TagHex.FileMetaInformationGroupLength,
        "UL",
        metaStream.size,
        metaSyntax,
        writeOptions
    );
    fileStream.concat(metaStream);

    var useSyntax = meta[TagHex.TransferSyntaxUID].Value[0];
    if (useSyntax === DEFLATED_EXPLICIT_LITTLE_ENDIAN) {
        // Deflate-on-write (W4). Per PS3.10 A.5 only the dataset
        // after the meta group is deflated - the preamble, "DICM" and
        // the meta group (written uncompressed above) never are. The
        // deflated syntax implies an explicit little endian body, so
        // the body is produced as ELE into a scratch stream, then
        // raw-deflated (RFC 1951, no zlib header - the mirror of the
        // read side's inflateRaw).
        const bodyStream = new WriteBufferStream(4096, true);
        writeDataSet(dict, bodyStream, EXPLICIT_LITTLE_ENDIAN, writeOptions);
        fileStream.writeRawBytes(
            pako.deflateRaw(new Uint8Array(bodyStream.getBuffer()))
        );
        return fileStream.getBuffer();
    }
    writeDataSet(dict, fileStream, useSyntax, writeOptions);
    return fileStream.getBuffer();
}
