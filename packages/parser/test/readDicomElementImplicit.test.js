import ByteStream from '../src/byteStream';
import readDicomElementImplicit from '../src/readDicomElementImplicit';
import littleEndianByteArrayParser from '../src/littleEndianByteArrayParser';

describe('readDicomElementImplicit', () => {

  function convertToByteArray(bytes) {
    const byteArray = new Uint8Array(bytes.length);
    let i = 0;

    bytes.forEach((byte) => { byteArray[i++] = byte; });

    return byteArray;
  }

  it('should return an element', () => {
    // Arrange
    const byteArray = new Uint8Array(8);

    byteArray[0] = 0x06;
    byteArray[1] = 0x30;
    byteArray[2] = 0xA6;
    byteArray[3] = 0x00;
    byteArray[4] = 0x00;
    byteArray[5] = 0x00;
    byteArray[6] = 0x00;
    byteArray[7] = 0x00;

    const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

    // Act
    const element = readDicomElementImplicit(byteStream);

    // Assert
    expect(element).toBeTruthy();
  });

  it('should return the expected element and length (truncated element defined)', () => {
    // Arrange
    const byteArray = new Uint8Array(8);

    byteArray[0] = 0x06;
    byteArray[1] = 0x30;
    byteArray[2] = 0xA6;
    byteArray[3] = 0x00;
    byteArray[4] = 0x00;
    byteArray[5] = 0xFF;
    byteArray[6] = 0xFF;
    byteArray[7] = 0xFF;

    const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

    // Act
    const element = readDicomElementImplicit(byteStream);

    // Assert
    // AD-1: defined-length elements are never peeked, so the truncated
    // buffer no longer produces the eof-while-peeking warning.
    expect(element).toBeTruthy();
    expect(byteStream.warnings.length).toBe(0);
  });

  it('should return the expected element and length (truncated element undefined)', () => {
    // Arrange
    const byteArray = new Uint8Array(8);

    byteArray[0] = 0x06;
    byteArray[1] = 0x30;
    byteArray[2] = 0xA6;
    byteArray[3] = 0x00;
    byteArray[4] = 0xFF;
    byteArray[5] = 0xFF;
    byteArray[6] = 0xFF;
    byteArray[7] = 0xFF;

    const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

    // Act
    const element = readDicomElementImplicit(byteStream);

    // Assert
    expect(element).toBeTruthy();
    // one warning from peeking past eof to determine VR, one from the missing
    // item delimitation item while scanning the undefined length element
    expect(byteStream.warnings.length).toBe(2);
  });

  it('defined-length dictionary-unknown element is never peek-promoted to SQ (AD-1)', () => {
    // Arrange
    // (0008,0006)                              18 — value bytes happen to
    // start with an item tag, but the declared length already delimits the
    // element, so it must be framed as a plain data blob (eager parity).
    const bytes = [0x08, 0x00, 0x06, 0x00, 0x12, 0x00, 0x00, 0x00,
      // (fffe,e000)                              10
      0xfe, 0xff, 0x00, 0xe0, 0x0A, 0x00, 0x00, 0x00,
      // (0008,0100)                               2   'A'
      0x08, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00, 0x41, 0x20,
    ];
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));

    // Act
    const element = readDicomElementImplicit(byteStream, undefined);

    // Assert
    expect(element.tag).toBe('x00080006');
    expect(element.items).toBe(undefined);
    expect(element.length).toBe(18);
    expect(element.endOffset).toBe(26);
  });

  it('implicit zero-length sequence with undefined length parses successfully without callback (using peeking)', () => {
    // Arrange
    // (0008,0006)               (undefined length)
    const bytes = [0x08, 0x00, 0x06, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,
      // (fffe,e0dd)                               0
      0xfe, 0xff, 0xdd, 0xe0, 0x00, 0x00, 0x00, 0x00,
      // (0008,0100)                               2   'A'
      0x08, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00, 0x41, 0x20,
    ];

    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));

    // Act
    const element = readDicomElementImplicit(byteStream);

    // Assert
    expect(element.tag).toBe('x00080006');
    expect(element.items).toEqual([]);
  });

  it('defined-length pixel data with item-tag-lookalike bytes parses as a blob (AD-1, was: throw)', () => {
    // Arrange
    // (7fe0,0010)                               8
    const bytes = [0xe0, 0x7f, 0x10, 0x00, 0x08, 0x00, 0x00, 0x00,
      // Looks like an item tag, but isn't since it's within pixel data
      0xfe, 0xff, 0x00, 0xe0, 0x0A, 0x00, 0x00, 0x00,
    ];
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));

    // Act
    const element = readDicomElementImplicit(byteStream, undefined);

    // Assert — the old peek misfired here and threw; defined lengths are
    // no longer peeked, so the element frames cleanly.
    expect(element.tag).toBe('x7fe00010');
    expect(element.items).toBe(undefined);
    expect(element.length).toBe(8);
  });

  it('defined-length pixel data with item-tag-lookalike bytes parses as a blob with an undefined-returning callback (AD-1, was: throw)', () => {
    // Arrange
    // (7fe0,0010)                               8
    const bytes = [0xe0, 0x7f, 0x10, 0x00, 0x08, 0x00, 0x00, 0x00,
      // Looks like an item tag, but isn't since it's within pixel data
      0xfe, 0xff, 0x00, 0xe0, 0x0A, 0x00, 0x00, 0x00,
    ];
    const callback = (tag) => {
      return undefined;
    };
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));

    // Act
    const element = readDicomElementImplicit(byteStream, undefined, callback);

    // Assert
    expect(element.tag).toBe('x7fe00010');
    expect(element.items).toBe(undefined);
    expect(element.length).toBe(8);
  });

  it('bytes resembling an item tag are not treated like an SQ item when using a callback (callback overrides peeking)', () => {
    // Arrange
    // (7fe0,0010)                               8
    const bytes = [0xe0, 0x7f, 0x10, 0x00, 0x08, 0x00, 0x00, 0x00,
      // Looks like an item tag, but isn't since it's within pixel data
      0xfe, 0xff, 0x00, 0xe0, 0x0A, 0x00, 0x00, 0x00,
    ];
    const callback = (tag) => {
      return (tag === 'x7fe00010') ? 'OW' : undefined;
    };
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));

    // Act
    const element = readDicomElementImplicit(byteStream, undefined, callback);

    // Assert
    expect(element.tag).toBe('x7fe00010');
    expect(element.items).toBe(undefined);
    expect(element.vr).toBe('OW');
    expect(element.length).toBe(8);
  });

  it('defined-length pixel data with delimiter-lookalike bytes parses as a blob (AD-1, was: throw)', () => {
    // Arrange
    // (7fe0,0010)                                           11
    const bytes = [0xe0, 0x7f, 0x10, 0x00, 0x0B, 0x00, 0x00, 0x00,
      // Looks like a sequence delimiter tag, but isn't since it's within pixel data
      0xfe, 0xff, 0xdd, 0xe0, 0x0A, 0x00, 0x00, 0x00,
      0x12, 0x43, 0x98,
    ];
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));

    // Act
    const element = readDicomElementImplicit(byteStream, undefined);

    // Assert — the old peek misfired here and threw; defined lengths are
    // no longer peeked, so the element frames cleanly.
    expect(element.tag).toBe('x7fe00010');
    expect(element.items).toBe(undefined);
    expect(element.length).toBe(11);
  });

  it('defined-length pixel data with delimiter-lookalike bytes parses as a blob with an undefined-returning callback (AD-1, was: throw)', () => {
    // Arrange
    // (7fe0,0010)                                           11
    const bytes = [0xe0, 0x7f, 0x10, 0x00, 0x0B, 0x00, 0x00, 0x00,
      // Looks like a sequence delimiter tag, but isn't since it's within pixel data
      0xfe, 0xff, 0xdd, 0xe0, 0x0A, 0x00, 0x00, 0x00,
      0x12, 0x43, 0x98,
    ];
    const callback = (tag) => {
      return undefined;
    };
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));

    // Act
    const element = readDicomElementImplicit(byteStream, undefined, callback);

    // Assert
    expect(element.tag).toBe('x7fe00010');
    expect(element.items).toBe(undefined);
    expect(element.length).toBe(11);
  });

  it('bytes resembling an end-of-sequence tag are not treated like an SQ item when using a callback (callback overrides peeking)', () => {
    // Arrange
    // (7fe0,0010)                              11
    const bytes = [0xe0, 0x7f, 0x10, 0x00, 0x0B, 0x00, 0x00, 0x00,
      // Looks like a sequence delimiter tag, but isn't since it's within pixel data
      0xfe, 0xff, 0xdd, 0xe0, 0x0A, 0x00, 0x00, 0x00,
      0x12, 0x43, 0x98,
    ];
    const callback = (tag) => {
      return (tag === 'x7fe00010') ? 'OW' : undefined;
    };
    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));

    // Act
    const element = readDicomElementImplicit(byteStream, undefined, callback);

    // Assert
    expect(element.tag).toBe('x7fe00010');
    expect(element.items).toBe(undefined);
    expect(element.vr).toBe('OW');
    expect(element.length).toBe(11);
  });

  it('private sequence with explicit length is skipped', () => {
    // Arrange
    // (0009,0006)                       length: 26
    const bytes = [0x09, 0x00, 0x06, 0x00, 0x1a, 0x00, 0x00, 0x00,
      // (fffe,e000)                     length: undefined
      0xfe, 0xff, 0x00, 0xe0, 0xff, 0xff, 0xff, 0xff,
      // (0008,0018)                      length: 2   'B'
      0x08, 0x00, 0x18, 0x00, 0x02, 0x00, 0x00, 0x00, 0x42, 0x20,
      // (fffe,e00d)                     length: 0
      0xfe, 0xff, 0x0d, 0xe0, 0x00, 0x00, 0x00, 0x00,
      // (0008,0100)                      length: 2   'A'
      0x08, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00, 0x41, 0x20,
    ];

    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));

    // Act
    const element = readDicomElementImplicit(byteStream);

    // Assert
    expect(element.tag).toBe('x00090006');
    expect(element.items).toBe(undefined);
    expect(element.length).toBe(26);

    // Read the next element
    const nextElement = readDicomElementImplicit(byteStream);
    expect(nextElement.tag).toBe('x00080100');
    expect(nextElement.length).toBe(2);
  });

  it('private sequence with implicit length is skipped', () => {
    // Arrange
    // (0009,0006)                       length: undefined
    const bytes = [0x09, 0x00, 0x06, 0x00, 0xff, 0xff, 0xff, 0xff,
      // (fffe,e000)                     length: undefined
      0xfe, 0xff, 0x00, 0xe0, 0xff, 0xff, 0xff, 0xff,
      // (0008,0018)                      length: 4   'ABC '
      0x08, 0x00, 0x18, 0x00, 0x04, 0x00, 0x00, 0x00, 0x41, 0x42, 0x43, 0x20,
      // (fffe,e00d)                     length: 0
      0xfe, 0xff, 0x0d, 0xe0, 0x00, 0x00, 0x00, 0x00,
      // (fffe,e0dd)                     length: 0
      0xfe, 0xff, 0xdd, 0xe0, 0x00, 0x00, 0x00, 0x00,
      // (0008,0100)                      length: 2   'A'
      0x08, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00, 0x41, 0x20,
    ];

    const byteStream = new ByteStream(littleEndianByteArrayParser, convertToByteArray(bytes));

    // Act
    const element = readDicomElementImplicit(byteStream);

    // Assert
    expect(element.tag).toBe('x00090006');
    expect(element.items).toBe(undefined);
    expect(element.length).toBe(28);

    // Read the next element
    const nextElement = readDicomElementImplicit(byteStream);
    expect(nextElement.tag).toBe('x00080100');
    expect(nextElement.length).toBe(2);
  });


});
