import ByteStream from '../src/byteStream';
import littleEndianByteArrayParser from '../src/littleEndianByteArrayParser';
import bigEndianByteArrayParser from '../src/bigEndianByteArrayParser';
import readDicomElementImplicit from '../src/readDicomElementImplicit';
import readSequenceItemsExplicit from '../src/readSequenceElementExplicit';
import readSequenceItemsImplicit from '../src/readSequenceElementImplicit';

// regression tests for the numeric tag peeks (replacing readTag() + seek(-4))
// in isSequence() and the undefined-length sequence-delimiter loops
describe('numeric tag peek', () => {

  describe('readDicomElementImplicit isSequence peek', () => {

    it('detects a sequence from an item start tag (fffe,e000) after the element header', () => {
      // Arrange - (0008,1115) undefined length, one empty item, sequence delimiter
      const byteArray = new Uint8Array([
        0x08, 0x00, 0x15, 0x11, 0xFF, 0xFF, 0xFF, 0xFF,
        // item (fffe,e000) length 0
        0xFE, 0xFF, 0x00, 0xE0, 0x00, 0x00, 0x00, 0x00,
        // sequence delimitation item (fffe,e0dd) length 0
        0xFE, 0xFF, 0xDD, 0xE0, 0x00, 0x00, 0x00, 0x00,
      ]);
      const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

      // Act
      const element = readDicomElementImplicit(byteStream);

      // Assert
      expect(element.tag).toBe('x00081115');
      expect(element.items.length).toBe(1);
      expect(byteStream.position).toBe(byteArray.length);
      expect(byteStream.warnings.length).toBe(0);
    });

    it('detects an empty sequence from an immediate sequence delimiter tag (fffe,e0dd)', () => {
      // Arrange - (0008,1115) undefined length followed directly by the delimiter
      const byteArray = new Uint8Array([
        0x08, 0x00, 0x15, 0x11, 0xFF, 0xFF, 0xFF, 0xFF,
        // sequence delimitation item (fffe,e0dd) length 0
        0xFE, 0xFF, 0xDD, 0xE0, 0x00, 0x00, 0x00, 0x00,
      ]);
      const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

      // Act
      const element = readDicomElementImplicit(byteStream);

      // Assert
      expect(element.items.length).toBe(0);
      expect(element.length).toBe(0);
      expect(byteStream.position).toBe(byteArray.length);
    });

    it('does not move the stream position when the peeked bytes are not a sequence tag', () => {
      // Arrange - (0010,0010) length 4 with non-delimiter data
      const byteArray = new Uint8Array([
        0x10, 0x00, 0x10, 0x00, 0x04, 0x00, 0x00, 0x00,
        0x41, 0x42, 0x43, 0x44,
      ]);
      const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

      // Act
      const element = readDicomElementImplicit(byteStream);

      // Assert - data starts right after the 8 byte header, peek left no offset behind
      expect(element.items).toBeUndefined();
      expect(element.dataOffset).toBe(8);
      expect(element.length).toBe(4);
      expect(byteStream.position).toBe(12);
    });

    it('still pushes the eof warning when fewer than 4 bytes remain for the peek', () => {
      // Arrange - (0010,0010) undefined length with only 2 bytes after the header
      const byteArray = new Uint8Array([
        0x10, 0x00, 0x10, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,
        0x00, 0x00,
      ]);
      const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

      // Act
      readDicomElementImplicit(byteStream);

      // Assert
      expect(byteStream.warnings).toContain(
        'eof encountered before finding sequence item tag or sequence delimiter tag in peeking to determine VR');
    });

  });

  describe('undefined-length sequence delimiter peek', () => {

    it('implicit: finds the delimiter and leaves the stream right after it', () => {
      // Arrange - one empty item then the sequence delimiter
      const byteArray = new Uint8Array([
        // item (fffe,e000) length 0
        0xFE, 0xFF, 0x00, 0xE0, 0x00, 0x00, 0x00, 0x00,
        // sequence delimitation item (fffe,e0dd) length 0
        0xFE, 0xFF, 0xDD, 0xE0, 0x00, 0x00, 0x00, 0x00,
      ]);
      const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);
      const element = { length: 0xFFFFFFFF, dataOffset: 0 };

      // Act
      readSequenceItemsImplicit(byteStream, element);

      // Assert
      expect(element.items.length).toBe(1);
      expect(element.length).toBe(8);
      expect(byteStream.position).toBe(byteArray.length);
      expect(byteStream.warnings.length).toBe(0);
    });

    it('explicit: finds the delimiter and leaves the stream right after it', () => {
      // Arrange - empty undefined length sequence: delimiter only
      const byteArray = new Uint8Array([
        // sequence delimitation item (fffe,e0dd) length 0
        0xFE, 0xFF, 0xDD, 0xE0, 0x00, 0x00, 0x00, 0x00,
      ]);
      const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);
      const element = { length: 0xFFFFFFFF, dataOffset: 0 };

      // Act
      readSequenceItemsExplicit(byteStream, element, []);

      // Assert
      expect(element.items.length).toBe(0);
      expect(element.length).toBe(0);
      expect(byteStream.position).toBe(byteArray.length);
    });

    it('explicit big endian: the peek honors the byte stream endianness', () => {
      // Arrange - empty item then sequence delimiter, big endian byte order
      const byteArray = new Uint8Array([
        // item (fffe,e000) length 0
        0xFF, 0xFE, 0xE0, 0x00, 0x00, 0x00, 0x00, 0x00,
        // sequence delimitation item (fffe,e0dd) length 0
        0xFF, 0xFE, 0xE0, 0xDD, 0x00, 0x00, 0x00, 0x00,
      ]);
      const byteStream = new ByteStream(bigEndianByteArrayParser, byteArray);
      const element = { length: 0xFFFFFFFF, dataOffset: 0 };

      // Act
      readSequenceItemsExplicit(byteStream, element, []);

      // Assert
      expect(element.items.length).toBe(1);
      expect(element.length).toBe(8);
      expect(byteStream.position).toBe(byteArray.length);
    });

    it('implicit: pushes the eof warning when no delimiter is found', () => {
      // Arrange - a single empty item, no sequence delimiter
      const byteArray = new Uint8Array([
        0xFE, 0xFF, 0x00, 0xE0, 0x00, 0x00, 0x00, 0x00,
      ]);
      const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);
      const element = { length: 0xFFFFFFFF, dataOffset: 0 };

      // Act
      readSequenceItemsImplicit(byteStream, element);

      // Assert
      expect(byteStream.warnings).toContain(
        'eof encountered before finding sequence delimiter in sequence of undefined length');
      expect(element.length).toBe(byteArray.length);
    });

  });

});
