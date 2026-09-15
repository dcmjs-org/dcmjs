import ByteStream from '../src/byteStream';
import littleEndianByteArrayParser from '../src/littleEndianByteArrayParser';
import findItemDelimitationItemAndSetElementLength from '../src/findItemDelimitationItem';
import readDicomElementExplicit from '../src/readDicomElementExplicit';

describe('findItemDelimitationItemAndSetElementLength', () => {

  it('should record a warning and not throw when the item delimitation item has a non zero length', () => {
    // Arrange
    // 4 bytes of element data followed by an item delimitation item (FFFE,E00D)
    // whose 4-byte length is non zero (4 instead of the required 0)
    const bytes = new Uint8Array([
      0x01, 0x02, 0x03, 0x04, // element data
      0xFE, 0xFF, 0x0D, 0xE0, // item delimitation item tag (FFFE,E00D)
      0x04, 0x00, 0x00, 0x00 // non zero length (invalid, should be 0)
    ]);
    const byteStream = new ByteStream(littleEndianByteArrayParser, bytes);
    const element = {
      tag: 'x00080018',
      dataOffset: 0,
      hadUndefinedLength: true
    };
    const warningsBefore = byteStream.warnings.length;

    // Act / Assert
    expect(() => findItemDelimitationItemAndSetElementLength(byteStream, element)).not.toThrow();
    expect(byteStream.warnings.length).toBe(warningsBefore + 1);
    expect(byteStream.warnings[0]).toContain('non zero length following item delimiter');
    expect(element.length).toBe(12); // data + delimitation item are consumed
    expect(byteStream.position).toBe(12);
  });

  it('should record a warning and not throw when scanning an undefined length explicit element with a non zero delimiter length', () => {
    // Arrange
    // explicit element (0008,0000) VR=OB with undefined length, followed by data
    // and an item delimitation item whose length is non zero
    const bytes = new Uint8Array([
      0x08, 0x00, 0x00, 0x00, // tag (0008,0000)
      0x4F, 0x42, // VR 'OB'
      0x00, 0x00, // reserved
      0xFF, 0xFF, 0xFF, 0xFF, // undefined length
      0x01, 0x02, 0x03, 0x04, // element data
      0xFE, 0xFF, 0x0D, 0xE0, // item delimitation item tag (FFFE,E00D)
      0x08, 0x00, 0x00, 0x00 // non zero length (invalid, should be 0)
    ]);
    const byteStream = new ByteStream(littleEndianByteArrayParser, bytes);

    // Act
    let element;

    expect(() => {
      element = readDicomElementExplicit(byteStream);
    }).not.toThrow();

    // Assert
    expect(element.hadUndefinedLength).toBe(true);
    expect(element.dataOffset).toBe(12);
    expect(element.length).toBe(12); // data + delimitation item are consumed
    expect(byteStream.warnings.length).toBe(1);
    expect(byteStream.warnings[0]).toContain('non zero length following item delimiter');
  });

  it('should record a warning and extend the element length to the end of the buffer when no item delimitation item is found', () => {
    // Arrange
    // 10 bytes of element data with no item delimitation item anywhere
    const bytes = new Uint8Array([
      0x01, 0x02, 0x03, 0x04, 0x05,
      0x06, 0x07, 0x08, 0x09, 0x0A
    ]);
    const byteStream = new ByteStream(littleEndianByteArrayParser, bytes);
    const element = {
      tag: 'x00080018',
      dataOffset: 0,
      hadUndefinedLength: true
    };

    // Act / Assert
    expect(() => findItemDelimitationItemAndSetElementLength(byteStream, element)).not.toThrow();
    expect(element.length).toBe(bytes.length); // element length extends to the end of the buffer
    expect(byteStream.position).toBe(bytes.length);
    expect(byteStream.warnings.length).toBe(1);
    expect(byteStream.warnings[0]).toContain('eof encountered before finding item delimiter');
  });

});
