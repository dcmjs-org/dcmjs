import fs from 'fs';
import path from 'path';
import ByteStream from '../src/byteStream';
import littleEndianByteArrayParser from '../src/littleEndianByteArrayParser';
import readDicomElementExplicit from '../src/readDicomElementExplicit';
import readDicomElementImplicit from '../src/readDicomElementImplicit';
import parseDicom from '../src/parseDicom';

// the single stable shape every parsed element must have (hidden-class guarantee)
const ELEMENT_KEYS = [
  'tag',
  'tagValue',
  'vr',
  'length',
  'dataOffset',
  'startOffset',
  'endOffset',
  'hadUndefinedLength',
  'parser',
  'items',
  'fragments',
  'basicOffsetTable',
  'encapsulatedPixelData',
  'Value',
];

// the single stable shape every sequence item must have
const ITEM_KEYS = [
  'tag',
  'tagValue',
  'length',
  'dataOffset',
  'startOffset',
  'endOffset',
  'hadUndefinedLength',
  'dataSet',
];

function collectElementsAndItems(dataSet, elements = [], items = []) {
  Object.keys(dataSet.elements).forEach((tag) => {
    const element = dataSet.elements[tag];

    elements.push(element);

    if (element.items !== undefined) {
      element.items.forEach((item) => {
        items.push(item);
        if (item.dataSet !== undefined) {
          collectElementsAndItems(item.dataSet, elements, items);
        }
      });
    }
  });

  return { elements, items };
}

describe('element byte spans', () => {

  it('explicit defined-length elements record startOffset/endOffset bracketing header+value exactly', () => {
    // Arrange - two consecutive explicit little endian elements
    const byteArray = new Uint8Array([
      // (0010,0010) PN length 4 'ABCD' - 8 byte header + 4 byte value
      0x10, 0x00, 0x10, 0x00, 0x50, 0x4E, 0x04, 0x00, 0x41, 0x42, 0x43, 0x44,
      // (0008,0018) ST length 2 'A ' - 8 byte header + 2 byte value
      0x08, 0x00, 0x18, 0x00, 0x53, 0x54, 0x02, 0x00, 0x41, 0x20,
    ]);
    const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

    // Act
    const first = readDicomElementExplicit(byteStream);
    const second = readDicomElementExplicit(byteStream);

    // Assert
    expect(first.tag).toBe('x00100010');
    expect(first.tagValue).toBe(0x00100010);
    expect(first.startOffset).toBe(0);
    expect(first.dataOffset).toBe(8);
    expect(first.length).toBe(4);
    expect(first.endOffset).toBe(12);
    expect(first.endOffset).toBe(first.dataOffset + first.length);
    expect(first.hadUndefinedLength).toBe(false);
    expect(Array.from(byteArray.subarray(first.startOffset, first.endOffset)))
      .toEqual(Array.from(byteArray.subarray(0, 12)));

    expect(second.tag).toBe('x00080018');
    expect(second.tagValue).toBe(0x00080018);
    expect(second.startOffset).toBe(12);
    expect(second.dataOffset).toBe(20);
    expect(second.length).toBe(2);
    expect(second.endOffset).toBe(22);
    expect(second.endOffset).toBe(second.dataOffset + second.length);
    expect(byteStream.position).toBe(second.endOffset);
  });

  it('implicit defined-length elements record startOffset/endOffset bracketing header+value exactly', () => {
    // Arrange - two consecutive implicit little endian elements
    const byteArray = new Uint8Array([
      // (0010,0010) length 4 'ABCD' - 8 byte header + 4 byte value
      0x10, 0x00, 0x10, 0x00, 0x04, 0x00, 0x00, 0x00, 0x41, 0x42, 0x43, 0x44,
      // (0008,0018) length 4 'ABCD' - 8 byte header + 4 byte value
      0x08, 0x00, 0x18, 0x00, 0x04, 0x00, 0x00, 0x00, 0x41, 0x42, 0x43, 0x44,
    ]);
    const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

    // Act
    const first = readDicomElementImplicit(byteStream);
    const second = readDicomElementImplicit(byteStream);

    // Assert
    expect(first.tag).toBe('x00100010');
    expect(first.tagValue).toBe(0x00100010);
    expect(first.startOffset).toBe(0);
    expect(first.dataOffset).toBe(8);
    expect(first.length).toBe(4);
    expect(first.endOffset).toBe(12);
    expect(first.endOffset).toBe(first.dataOffset + first.length);
    expect(first.hadUndefinedLength).toBe(false);

    expect(second.tag).toBe('x00080018');
    expect(second.tagValue).toBe(0x00080018);
    expect(second.startOffset).toBe(12);
    expect(second.dataOffset).toBe(20);
    expect(second.length).toBe(4);
    expect(second.endOffset).toBe(24);
    expect(second.endOffset).toBe(second.dataOffset + second.length);
    expect(byteStream.position).toBe(second.endOffset);
  });

  it('explicit undefined-length SQ endOffset includes the sequence delimitation item and round-trips the on-disk bytes', () => {
    // Arrange - a leading element so the SQ starts at a non zero offset, then an
    // undefined-length SQ with one defined-length item, then the sequence delimitation item
    const leadingBytes = [
      // (0008,0018) ST length 2 'A '
      0x08, 0x00, 0x18, 0x00, 0x53, 0x54, 0x02, 0x00, 0x41, 0x20,
    ];
    const sqBytes = [
      // (0008,1115) SQ undefined length - 12 byte header
      0x08, 0x00, 0x15, 0x11, 0x53, 0x51, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,
      // item (fffe,e000) length 10
      0xFE, 0xFF, 0x00, 0xE0, 0x0A, 0x00, 0x00, 0x00,
      // (0008,0100) CS length 2 'A '
      0x08, 0x00, 0x00, 0x01, 0x43, 0x53, 0x02, 0x00, 0x41, 0x20,
      // sequence delimitation item (fffe,e0dd) length 0 - 8 bytes
      0xFE, 0xFF, 0xDD, 0xE0, 0x00, 0x00, 0x00, 0x00,
    ];
    const byteArray = new Uint8Array(leadingBytes.concat(sqBytes));
    const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

    // Act
    const leading = readDicomElementExplicit(byteStream);
    const sq = readDicomElementExplicit(byteStream);

    // Assert
    expect(leading.endOffset).toBe(10);
    expect(sq.tag).toBe('x00081115');
    expect(sq.tagValue).toBe(0x00081115);
    expect(sq.vr).toBe('SQ');
    expect(sq.hadUndefinedLength).toBe(true);
    expect(sq.startOffset).toBe(10);
    expect(sq.dataOffset).toBe(22);
    // the corrected length excludes the 8-byte sequence delimitation item...
    expect(sq.length).toBe(18);
    // ...but endOffset includes it
    expect(sq.endOffset).toBe(sq.dataOffset + sq.length + 8);
    expect(sq.endOffset).toBe(byteArray.length);
    expect(byteStream.position).toBe(sq.endOffset);

    // the recorded span round-trips the entire on-disk element
    expect(Array.from(byteArray.subarray(sq.startOffset, sq.endOffset))).toEqual(sqBytes);

    // the item span brackets item header + item data
    expect(sq.items.length).toBe(1);
    const item = sq.items[0];

    expect(item.tag).toBe('xfffee000');
    expect(item.tagValue).toBe(0xfffee000);
    expect(item.hadUndefinedLength).toBe(false);
    expect(item.startOffset).toBe(22);
    expect(item.dataOffset).toBe(30);
    expect(item.length).toBe(10);
    expect(item.endOffset).toBe(item.dataOffset + item.length);
  });

  it('encapsulated pixel data endOffset lands after the sequence delimiter', () => {
    // Arrange - encapsulated (7fe0,0010) OB with empty basic offset table, one fragment
    // and the sequence delimitation item
    const byteArray = new Uint8Array([
      // (7fe0,0010) OB undefined length - 12 byte header
      0xE0, 0x7F, 0x10, 0x00, 0x4F, 0x42, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,
      // basic offset table item (fffe,e000) length 0
      0xFE, 0xFF, 0x00, 0xE0, 0x00, 0x00, 0x00, 0x00,
      // fragment item (fffe,e000) length 4
      0xFE, 0xFF, 0x00, 0xE0, 0x04, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
      // sequence delimitation item (fffe,e0dd) length 0 - 8 bytes
      0xFE, 0xFF, 0xDD, 0xE0, 0x00, 0x00, 0x00, 0x00,
    ]);
    const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

    // Act
    const element = readDicomElementExplicit(byteStream);

    // Assert
    expect(element.tag).toBe('x7fe00010');
    expect(element.tagValue).toBe(0x7fe00010);
    expect(element.encapsulatedPixelData).toBe(true);
    expect(element.hadUndefinedLength).toBe(true);
    expect(element.fragments.length).toBe(1);
    expect(element.startOffset).toBe(0);
    expect(element.dataOffset).toBe(12);
    // endOffset is positioned after the trailing 8-byte sequence delimitation item
    expect(element.endOffset).toBe(byteArray.length);
    expect(element.endOffset).toBe(byteStream.position);
    expect(Array.from(byteArray.subarray(element.startOffset, element.endOffset)))
      .toEqual(Array.from(byteArray));
  });

  it('all elements produced from one parse share the same property set (hidden-class guarantee)', () => {
    // Arrange
    const filePath = path.join(__dirname, '../testImages/CT1_UNC.explicit_little_endian.dcm');
    const byteArray = new Uint8Array(fs.readFileSync(filePath));

    // Act
    const dataSet = parseDicom(byteArray);
    const { elements, items } = collectElementsAndItems(dataSet);

    // Assert
    expect(elements.length).toBeGreaterThan(0);
    elements.forEach((element) => {
      expect(Object.keys(element)).toEqual(ELEMENT_KEYS);
    });
    items.forEach((item) => {
      expect(Object.keys(item)).toEqual(ITEM_KEYS);
    });
  });

  it('implicit parse elements share the same property set as explicit parse elements', () => {
    // Arrange
    const explicitPath = path.join(__dirname, '../testImages/CT1_UNC.explicit_little_endian.dcm');
    const implicitPath = path.join(__dirname, '../testImages/CT1_UNC.implicit_little_endian.dcm');

    // Act
    const explicitDataSet = parseDicom(new Uint8Array(fs.readFileSync(explicitPath)));
    const implicitDataSet = parseDicom(new Uint8Array(fs.readFileSync(implicitPath)));
    const explicitCollected = collectElementsAndItems(explicitDataSet);
    const implicitCollected = collectElementsAndItems(implicitDataSet);

    // Assert
    expect(implicitCollected.elements.length).toBeGreaterThan(0);
    implicitCollected.elements.forEach((element) => {
      expect(Object.keys(element)).toEqual(ELEMENT_KEYS);
    });
    expect(Object.keys(explicitCollected.elements[0])).toEqual(Object.keys(implicitCollected.elements[0]));
  });

});
