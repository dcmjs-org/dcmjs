/**
 * Internal helper functions for parsing DICOM elements
 */

/**
 * Reads a tag (group number and element number) from a byteStream and returns
 * both the string form and the numeric form of the tag.
 * @param byteStream the byte stream to read from
 * @returns {{tag: string, tagValue: number}} tag is the string in format xggggeeee where
 * gggg is the lowercase hex value of the group number and eeee is the lower case hex value
 * of the element number; tagValue is the numeric (group << 16 | element) >>> 0
 */
export function readTagPair (byteStream) {
  if (byteStream === undefined) {
    throw 'dicomParser.readTag: missing required parameter \'byteStream\'';
  }

  const groupNumber = byteStream.readUint16();
  const elementNumber = byteStream.readUint16();
  const tagValue = ((groupNumber << 16) | elementNumber) >>> 0;
  const tag = `x${(`00000000${tagValue.toString(16)}`).substr(-8)}`;

  return { tag, tagValue };
}

/**
 * Reads a tag (group number and element number) from a byteStream
 * @param byteStream the byte stream to read from
 * @returns {string} the tag in format xggggeeee where gggg is the lowercase hex value of the group number
 * and eeee is the lower case hex value of the element number
 */
export default function readTag (byteStream) {
  return readTagPair(byteStream).tag;
}
