import { UNDEFINED_LENGTH } from "../../src/constants/dicom";
import { WriteBufferStream } from "../../src/BufferStream";
import { DicomMessage } from "../../src/DicomMessage";

/**
 * Writes the value bytes of a sequence: one item per dataset in `items`,
 * with defined or undefined lengths for the sequence and the items.
 * Returns the stream and the sequence length to put in the SQ header.
 */
export function writeSequenceItems(
    items,
    syntax,
    undefinedSequence,
    undefinedItems
) {
    const stream = new WriteBufferStream({ defaultSize: 256 });
    for (const value of items) {
        const itemStream = new WriteBufferStream({ defaultSize: 256 });
        DicomMessage.write(value, itemStream, syntax);
        stream.writeUint16(0xfffe);
        stream.writeUint16(0xe000);
        stream.writeUint32(undefinedItems ? UNDEFINED_LENGTH : itemStream.size);
        stream.concat(itemStream);
        if (undefinedItems) {
            stream.writeUint16(0xfffe);
            stream.writeUint16(0xe00d);
            stream.writeUint32(0);
        }
    }
    const sqLength = undefinedSequence ? UNDEFINED_LENGTH : stream.size;
    if (undefinedSequence) {
        stream.writeUint16(0xfffe);
        stream.writeUint16(0xe0dd);
        stream.writeUint32(0);
    }
    return { stream, sqLength };
}

/** The four length combinations as [undefinedSequence, undefinedItems]. */
export const LENGTH_CASES = [
    [false, false],
    [false, true],
    [true, false],
    [true, true]
];
