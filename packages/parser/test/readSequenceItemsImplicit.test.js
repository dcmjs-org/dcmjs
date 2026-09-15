import ByteStream from '../src/byteStream';
import littleEndianByteArrayParser from '../src/littleEndianByteArrayParser';
import readSequenceItemsImplicit from '../src/readSequenceElementImplicit';

describe('readSequenceItemsImplicit', () => {

  function convertToByteArray(bytes) {
    const byteArray = new Uint8Array(bytes.length);
    let i = 0;

    bytes.forEach((byte) => { byteArray[i++] = byte; });

    return byteArray;
  }

  it('element that looks like SQ is properly parsed in an undefined-length item in an undefined-length sequence with provided callback', () => {
    // Arrange
    // (fffe,e000)              (undefined length)
    const bytes = [0xfe, 0xff, 0x00, 0xe0, 0xFF, 0xFF, 0xFF, 0xFF,
                 // (7fe0,0010)                               8
                 0xe0, 0x7f, 0x10, 0x00, 0x08, 0x00, 0x00, 0x00,
                 // Looks like an item tag, but isn't since it's within pixel data
                 0xfe, 0xff, 0x00, 0xe0, 0x0A, 0x00, 0x00, 0x00,
                 // (fffe,e00d)                               0
                 0xfe, 0xff, 0x0d, 0xe0, 0x00, 0x00, 0x00, 0x00,
                 // (fffe,e0dd)                               0
                 0xfe, 0xff, 0xdd, 0xe0, 0x00, 0x00, 0x00, 0x00,
    ];
    const callback = (tag) => {
      return (tag === 'x7fe00010') ? 'OW' : undefined;
    };
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));
    const element = { length: 0xFFFFFFFF };

    // Act
    readSequenceItemsImplicit(byteStream, element, callback);

    // Assert
    expect(element.items.length).toBe(1);

    const sequenceItem = element.items[0];

    expect(sequenceItem).toBeTruthy();
    expect(sequenceItem.length).toBe(24);

    const pixelData = sequenceItem.dataSet.elements['x7fe00010'];

    expect(pixelData).toBeTruthy();
    expect(pixelData.length).toBe(8);
    expect(pixelData.vr).toBe('OW');
    expect(sequenceItem.dataSet.elements['xfffee00d']).toBeTruthy();
    expect(byteStream.warnings.length).toBe(0);
  });

  it('should generate warnings for missing item and sequence delimiters', () => {
    // Arrange
    // (fffe,e000)              (undefined length)
    const bytes = [0xfe, 0xff, 0x00, 0xe0, 0xFF, 0xFF, 0xFF, 0xFF,
                // (7fe0,0010)                               4
                0xe0, 0x7f, 0x10, 0x00, 0x04, 0x00, 0x00, 0x00,
                0x01, 0x23, 0x45, 0x67,
    ];
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));
    const element = { length: 0xFFFFFFFF };

    // Act
    readSequenceItemsImplicit(byteStream, element);

    // Assert
    expect(element.items.length).toBe(1);

    const sequenceItem = element.items[0];

    expect(sequenceItem).toBeTruthy();
    expect(sequenceItem.length).toBe(12);

    const pixelData = sequenceItem.dataSet.elements['x7fe00010'];

    expect(pixelData).toBeTruthy();
    expect(pixelData.length).toBe(4);
    expect(byteStream.warnings.length).toBe(2);
    expect(byteStream.warnings.some((warning) => warning.indexOf('sequence item delimiter') > -1)).toBeTruthy();
    expect(byteStream.warnings.some((warning) => warning.indexOf('sequence delimiter') > -1)).toBeTruthy();
  });

  it('element that looks like SQ is properly parsed in an item with defined length in an undefined-length sequence with provided callback', () => {
    // Arrange
     // (fffe,e000)                              16
    const bytes = [0xfe, 0xff, 0x00, 0xe0, 0x10, 0x00, 0x00, 0x00,
                 // (7fe0,0010)                               8
                 0xe0, 0x7f, 0x10, 0x00, 0x08, 0x00, 0x00, 0x00,
                 // Looks like an item tag, but isn't since it's within pixel data
                 0xfe, 0xff, 0x00, 0xe0, 0x0A, 0x00, 0x00, 0x00,
                 // (fffe,e0dd)                               0
                 0xfe, 0xff, 0xdd, 0xe0, 0x00, 0x00, 0x00, 0x00,
    ];
    const callback = (tag) => {
      return (tag === 'x7fe00010') ? 'OW' : undefined;
    };
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));
    const element = { length: 0xFFFFFFFF };

    // Act
    readSequenceItemsImplicit(byteStream, element, callback);

    // Assert
    expect(element.items.length).toBe(1);

    const sequenceItem = element.items[0];

    expect(sequenceItem).toBeTruthy();
    expect(sequenceItem.length).toBe(16);

    const pixelData = sequenceItem.dataSet.elements['x7fe00010'];

    expect(pixelData).toBeTruthy();
    expect(pixelData.length).toBe(8);
    expect(pixelData.vr).toBe('OW');
    expect(byteStream.warnings.length).toBe(0);
  });

  it('element that looks like SQ is properly parsed in an item with defined length in a defined-length sequence with provided callback', () => {
    // Arrange
                 // (fffe,e000)                              16
    const bytes = [0xfe, 0xff, 0x00, 0xe0, 0x10, 0x00, 0x00, 0x00,
                 // (7fe0,0010)                               8
                 0xe0, 0x7f, 0x10, 0x00, 0x08, 0x00, 0x00, 0x00,
                 // Looks like an item tag, but isn't since it's within pixel data
                 0xfe, 0xff, 0x00, 0xe0, 0x0A, 0x00, 0x00, 0x00,
    ];
    const callback = (tag) => {
      return (tag === 'x7fe00010') ? 'OW' : undefined;
    };
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));
    const element = {dataOffset: 0, length: 24};

    // Act
    readSequenceItemsImplicit(byteStream, element, callback);

    // Assert
    expect(element.items.length).toBe(1);

    const sequenceItem = element.items[0];

    expect(sequenceItem).toBeTruthy();
    expect(sequenceItem.length).toBe(16);

    const pixelData = sequenceItem.dataSet.elements['x7fe00010'];

    expect(pixelData).toBeTruthy();
    expect(pixelData.length).toBe(8);
    expect(pixelData.vr).toBe('OW');
    expect(byteStream.warnings.length).toBe(0);
  });

  it('should not crash because a malformed tag at end of stream', () => {
    // Arrange
    const bytes = new Uint8Array(1);
    const element = {length: 0xFFFFFFFF};
    const byteStream = new ByteStream(littleEndianByteArrayParser, bytes);

    // Act
    readSequenceItemsImplicit(byteStream, element);

    // Assert
    expect(byteStream.warnings.length).toBe(1);
  });

  it('should throw an exception for undefined byteStream', () => {
    const invoker = () => readSequenceItemsImplicit(undefined, { length: 0xFFFFFFFF });

    // Assert
    expect(invoker).toThrow();
  });

  it('should throw an exception for undefined element', () => {
    // Arrange
    const byteStream = new ByteStream(littleEndianByteArrayParser, new Uint8Array(1));
    const invoker = () => readSequenceItemsImplicit(byteStream);

    // Assert
    expect(invoker).toThrow();
  });

});
