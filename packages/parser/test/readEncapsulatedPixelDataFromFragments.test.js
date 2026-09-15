import ByteStream from '../src/byteStream';
import DataSet from '../src/dataSet';
import littleEndianByteArrayParser from '../src/littleEndianByteArrayParser';
import readDicomElementExplicit from '../src/readDicomElementExplicit';
import readEncapsulatedPixelDataFromFragments from '../src/readEncapsulatedPixelDataFromFragments';

// Builds an explicit little endian encapsulated (7fe0,0010) OB element with an
// empty basic offset table followed by the supplied fragments.
function makeEncapsulatedPixelDataByteArray (fragmentContents) {
  const bytes = [
    // (7fe0,0010) OB undefined length - 12 byte header
    0xE0, 0x7F, 0x10, 0x00, 0x4F, 0x42, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,
    // basic offset table item (fffe,e000) length 0
    0xFE, 0xFF, 0x00, 0xE0, 0x00, 0x00, 0x00, 0x00,
  ];

  fragmentContents.forEach((content) => {
    // fragment item (fffe,e000) with 4 byte little endian length
    bytes.push(0xFE, 0xFF, 0x00, 0xE0,
      content.length & 0xFF,
      (content.length >> 8) & 0xFF,
      (content.length >> 16) & 0xFF,
      (content.length >> 24) & 0xFF);
    content.forEach((byte) => bytes.push(byte));
  });

  // sequence delimitation item (fffe,e0dd) length 0
  bytes.push(0xFE, 0xFF, 0xDD, 0xE0, 0x00, 0x00, 0x00, 0x00);

  return new Uint8Array(bytes);
}

function makeDataSetWithEncapsulatedPixelData (byteArray) {
  const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);
  const element = readDicomElementExplicit(byteStream);
  const elements = {};

  elements[element.tag] = element;

  return {
    dataSet: new DataSet(littleEndianByteArrayParser, byteArray, elements),
    element,
  };
}

// the byte-by-byte copy loop this implementation replaced; used as the
// behavioral reference for byte-identical output
function naiveCopy (dataSet, pixelDataElement, fragments, startFragmentIndex, numFragments) {
  // dataOffset + basic offset table item header (8) + basic offset table length (0)
  const fragmentZeroPosition = pixelDataElement.dataOffset + 8 + pixelDataElement.basicOffsetTable.length * 4;
  const fragmentHeaderSize = 8;
  let bufferSize = 0;

  for (let i = startFragmentIndex; i < startFragmentIndex + numFragments; i++) {
    bufferSize += fragments[i].length;
  }

  const pixelData = new Uint8Array(bufferSize);
  let pixelDataIndex = 0;

  for (let i = startFragmentIndex; i < startFragmentIndex + numFragments; i++) {
    let fragmentOffset = fragmentZeroPosition + fragments[i].offset + fragmentHeaderSize;

    for (let j = 0; j < fragments[i].length; j++) {
      pixelData[pixelDataIndex++] = dataSet.byteArray[fragmentOffset++];
    }
  }

  return pixelData;
}

describe('readEncapsulatedPixelDataFromFragments', () => {

  it('should combine multiple fragments byte-identically to a naive byte-by-byte copy', () => {
    // Arrange - three fragments with distinct, uneven contents
    const fragmentContents = [
      [0x01, 0x02, 0x03, 0x04],
      [0x05, 0x06, 0x07, 0x08, 0x09, 0x0A],
      [0xFF, 0x00],
    ];
    const byteArray = makeEncapsulatedPixelDataByteArray(fragmentContents);
    const { dataSet, element } = makeDataSetWithEncapsulatedPixelData(byteArray);

    // Act
    const pixelData = readEncapsulatedPixelDataFromFragments(dataSet, element, 0, 3);

    // Assert
    const expected = naiveCopy(dataSet, element, element.fragments, 0, 3);

    expect(pixelData.length).toBe(12);
    expect(Array.from(pixelData)).toEqual(Array.from(expected));
    expect(Array.from(pixelData)).toEqual([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0xFF, 0x00]);
  });

  it('should combine a subset of fragments starting at a non-zero index', () => {
    // Arrange
    const fragmentContents = [
      [0x11, 0x22],
      [0x33, 0x44, 0x55],
      [0x66],
      [0x77, 0x88, 0x99, 0xAA],
    ];
    const byteArray = makeEncapsulatedPixelDataByteArray(fragmentContents);
    const { dataSet, element } = makeDataSetWithEncapsulatedPixelData(byteArray);

    // Act
    const pixelData = readEncapsulatedPixelDataFromFragments(dataSet, element, 1, 2);

    // Assert
    const expected = naiveCopy(dataSet, element, element.fragments, 1, 2);

    expect(Array.from(pixelData)).toEqual(Array.from(expected));
    expect(Array.from(pixelData)).toEqual([0x33, 0x44, 0x55, 0x66]);
  });

  it('should combine multiple fragments byte-identically when the byteArray is a Node Buffer', () => {
    // Arrange
    const fragmentContents = [
      [0xDE, 0xAD],
      [0xBE, 0xEF, 0x01],
    ];
    const byteArray = Buffer.from(makeEncapsulatedPixelDataByteArray(fragmentContents));
    const { dataSet, element } = makeDataSetWithEncapsulatedPixelData(byteArray);

    // Act
    const pixelData = readEncapsulatedPixelDataFromFragments(dataSet, element, 0, 2);

    // Assert
    const expected = naiveCopy(dataSet, element, element.fragments, 0, 2);

    expect(Buffer.isBuffer(pixelData)).toBe(true);
    expect(Array.from(pixelData)).toEqual(Array.from(expected));
    expect(Array.from(pixelData)).toEqual([0xDE, 0xAD, 0xBE, 0xEF, 0x01]);
  });

  it('should still return a shared view for a single fragment', () => {
    // Arrange
    const fragmentContents = [
      [0x10, 0x20, 0x30],
      [0x40, 0x50],
    ];
    const byteArray = makeEncapsulatedPixelDataByteArray(fragmentContents);
    const { dataSet, element } = makeDataSetWithEncapsulatedPixelData(byteArray);

    // Act
    const pixelData = readEncapsulatedPixelDataFromFragments(dataSet, element, 1, 1);

    // Assert
    expect(Array.from(pixelData)).toEqual([0x40, 0x50]);
    expect(pixelData.buffer).toBe(byteArray.buffer);
  });

});
