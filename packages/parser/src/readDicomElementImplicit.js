import findItemDelimitationItemAndSetElementLength from './findItemDelimitationItem.js';
import readSequenceItemsImplicit from './readSequenceElementImplicit.js';
import { readTagPair } from './readTag.js';
import { isPrivateTag } from './util/util.js';

/**
 * Internal helper functions for for parsing DICOM elements
 */

const isSequence = (element, byteStream) => {
  if (element.vr !== undefined) {
    return (element.vr === 'SQ');
  }

  // AD-1 (divergence from upstream dicom-parser): the data peek applies only
  // to undefined-length elements, where framing genuinely needs it (there is
  // no other way to find the element's end). A defined length already
  // delimits the element, and the semantic contract
  // (decodeCore.resolveVrInstance, eager parity) never promotes
  // defined-length dictionary-miss elements to SQ — peeking here could also
  // read past short values or misparse value bytes that merely resemble an
  // item tag (e.g. a value starting with FFFE,E0DD).
  if (!element.hadUndefinedLength) {
    return false;
  }

  if ((byteStream.position + 4) <= byteStream.byteArray.length) {
    // numeric peek without moving the stream position (replaces readTag() + seek(-4))
    const group = byteStream.byteArrayParser.readUint16(byteStream.byteArray, byteStream.position);
    const elementNumber = byteStream.byteArrayParser.readUint16(byteStream.byteArray, byteStream.position + 2);

    // Item start tag (fffe,e000) or sequence delimiter (i.e. end of sequence) tag (0fffe,e0dd)
    // These are the tags that could potentially be found directly after a sequence start tag (the delimiter
    // is found in the case of an empty sequence). This is not 100% safe because a non-sequence item
    // could have data that has these bytes, but this is how to do it without a data dictionary.
    return (group === 0xFFFE) && ((elementNumber === 0xE000) || (elementNumber === 0xE0DD));
  }

  byteStream.warnings.push('eof encountered before finding sequence item tag or sequence delimiter tag in peeking to determine VR');

  return false;
};

export default function readDicomElementImplicit (byteStream, untilTag, vrCallback) {
  if (byteStream === undefined) {
    throw 'dicomParser.readDicomElementImplicit: missing required parameter \'byteStream\'';
  }

  const startOffset = byteStream.position;
  const { tag, tagValue } = readTagPair(byteStream);

  // single object literal with all fields present so every element shares one hidden class;
  // later code may only mutate these fields, never add new ones
  const element = {
    tag,
    tagValue,
    vr: (vrCallback !== undefined ? vrCallback(tag) : undefined),
    length: byteStream.readUint32(),
    dataOffset: byteStream.position,
    startOffset,
    endOffset: 0,
    hadUndefinedLength: false,
    parser: undefined,
    items: undefined,
    fragments: undefined,
    basicOffsetTable: undefined,
    encapsulatedPixelData: false,
    Value: undefined
  };

  if (element.length === 4294967295) {
    element.hadUndefinedLength = true;
  }

  if (element.tag === untilTag) {
    // the data is not consumed; the best known end is the declared span for
    // defined lengths and the current (post header) position otherwise
    element.endOffset = element.hadUndefinedLength ? byteStream.position : element.dataOffset + element.length;

    return element;
  }

  // always parse sequences with undefined lengths, since there's no other way to know how long they are.
  if (isSequence(element, byteStream) && (!isPrivateTag(element.tag) || element.hadUndefinedLength)) {
    // parse the sequence
    readSequenceItemsImplicit(byteStream, element, vrCallback);

    if (isPrivateTag(element.tag)) {
      element.items = undefined;
    }

    element.endOffset = byteStream.position;

    return element;
  }

  // if element is not a sequence and has undefined length, we have to
  // scan the data for a magic number to figure out when it ends.
  if (element.hadUndefinedLength) {
    findItemDelimitationItemAndSetElementLength(byteStream, element);
    element.endOffset = byteStream.position;

    return element;
  }

  // non sequence element with known length, skip over the data part
  byteStream.seek(element.length);
  element.endOffset = byteStream.position;

  return element;
}
