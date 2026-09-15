import { readTagPair } from './readTag.js';

/**
 * Internal helper functions for parsing DICOM elements
 */

/**
 * Reads the tag and length of a sequence item and returns them as an object with the following properties
 *  tag : string for the tag of this element in the format xggggeeee
 *  tagValue: numeric value of the tag ((group << 16 | element) >>> 0)
 *  length: the number of bytes in this item or 4294967295 if undefined
 *  dataOffset: the offset into the byteStream of the data for this item
 *  startOffset: the offset into the byteStream where the item tag begins
 *  endOffset: the offset into the byteStream after the item is fully consumed (set by the sequence readers)
 *  hadUndefinedLength: true if the item had undefined length (set by the sequence readers)
 *  dataSet: the parsed item contents (set by the sequence readers)
 * @param byteStream the byte
 * @returns {{tag: string, tagValue: number, length: integer, dataOffset: integer, startOffset: integer, endOffset: integer, hadUndefinedLength: boolean, dataSet: undefined}}
 */
export default function readSequenceItem (byteStream) {
  if (byteStream === undefined) {
    throw 'dicomParser.readSequenceItem: missing required parameter \'byteStream\'';
  }

  const startOffset = byteStream.position;
  const { tag, tagValue } = readTagPair(byteStream);

  // single object literal with all fields present so every sequence item shares one hidden class;
  // later code may only mutate these fields, never add new ones
  const element = {
    tag,
    tagValue,
    length: byteStream.readUint32(),
    dataOffset: byteStream.position,
    startOffset,
    endOffset: 0,
    hadUndefinedLength: false,
    dataSet: undefined
  };

  if (element.tag !== 'xfffee000') {
    throw `dicomParser.readSequenceItem: item tag (FFFE,E000) not found at offset ${byteStream.position}`;
  }

  return element;
}
