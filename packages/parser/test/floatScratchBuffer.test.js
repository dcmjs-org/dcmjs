import littleEndianByteArrayParser from '../src/littleEndianByteArrayParser';
import bigEndianByteArrayParser from '../src/bigEndianByteArrayParser';

// the float/double readers share a module-level scratch buffer; these tests
// prove consecutive and interleaved reads return correct independent values
// (no state from one read leaks into the next)
describe('float/double scratch buffer reuse', () => {

  describe('littleEndianByteArrayParser', () => {

    it('two consecutive readFloat calls return correct independent values', () => {
      // Arrange - -5.625 followed by -22.5
      const byteArray = new Uint8Array([0x00, 0x00, 0xB4, 0xC0, 0x00, 0x00, 0xB4, 0xC1]);

      // Act
      const first = littleEndianByteArrayParser.readFloat(byteArray, 0);
      const second = littleEndianByteArrayParser.readFloat(byteArray, 4);
      const firstAgain = littleEndianByteArrayParser.readFloat(byteArray, 0);

      // Assert
      expect(first).toBe(-5.625);
      expect(second).toBe(-22.5);
      expect(firstAgain).toBe(-5.625);
    });

    it('two consecutive readDouble calls return correct independent values', () => {
      // Arrange - 1.5 followed by -2.25 (little endian float64)
      const byteArray = new Uint8Array(16);
      new DataView(byteArray.buffer).setFloat64(0, 1.5, true);
      new DataView(byteArray.buffer).setFloat64(8, -2.25, true);

      // Act
      const first = littleEndianByteArrayParser.readDouble(byteArray, 0);
      const second = littleEndianByteArrayParser.readDouble(byteArray, 8);
      const firstAgain = littleEndianByteArrayParser.readDouble(byteArray, 0);

      // Assert
      expect(first).toBe(1.5);
      expect(second).toBe(-2.25);
      expect(firstAgain).toBe(1.5);
    });

    it('interleaved readFloat/readDouble calls do not corrupt each other', () => {
      // Arrange
      const byteArray = new Uint8Array(12);
      const view = new DataView(byteArray.buffer);

      view.setFloat32(0, 3.5, true);
      view.setFloat64(4, -123.0625, true);

      // Act / Assert
      expect(littleEndianByteArrayParser.readDouble(byteArray, 4)).toBe(-123.0625);
      expect(littleEndianByteArrayParser.readFloat(byteArray, 0)).toBe(3.5);
      expect(littleEndianByteArrayParser.readDouble(byteArray, 4)).toBe(-123.0625);
      expect(littleEndianByteArrayParser.readFloat(byteArray, 0)).toBe(3.5);
    });

  });

  describe('bigEndianByteArrayParser', () => {

    it('two consecutive readFloat calls return correct independent values', () => {
      // Arrange - 1.25 followed by -7.5 (big endian float32)
      const byteArray = new Uint8Array(8);
      const view = new DataView(byteArray.buffer);

      view.setFloat32(0, 1.25, false);
      view.setFloat32(4, -7.5, false);

      // Act
      const first = bigEndianByteArrayParser.readFloat(byteArray, 0);
      const second = bigEndianByteArrayParser.readFloat(byteArray, 4);
      const firstAgain = bigEndianByteArrayParser.readFloat(byteArray, 0);

      // Assert
      expect(first).toBe(1.25);
      expect(second).toBe(-7.5);
      expect(firstAgain).toBe(1.25);
    });

    it('two consecutive readDouble calls return correct independent values', () => {
      // Arrange - 1e10 followed by -0.0001220703125 (big endian float64)
      const byteArray = new Uint8Array(16);
      const view = new DataView(byteArray.buffer);

      view.setFloat64(0, 1e10, false);
      view.setFloat64(8, -0.0001220703125, false);

      // Act
      const first = bigEndianByteArrayParser.readDouble(byteArray, 0);
      const second = bigEndianByteArrayParser.readDouble(byteArray, 8);
      const firstAgain = bigEndianByteArrayParser.readDouble(byteArray, 0);

      // Assert
      expect(first).toBe(1e10);
      expect(second).toBe(-0.0001220703125);
      expect(firstAgain).toBe(1e10);
    });

    it('interleaved readFloat/readDouble calls do not corrupt each other', () => {
      // Arrange
      const byteArray = new Uint8Array(12);
      const view = new DataView(byteArray.buffer);

      view.setFloat32(0, -64.125, false);
      view.setFloat64(4, 98765.4375, false);

      // Act / Assert
      expect(bigEndianByteArrayParser.readDouble(byteArray, 4)).toBe(98765.4375);
      expect(bigEndianByteArrayParser.readFloat(byteArray, 0)).toBe(-64.125);
      expect(bigEndianByteArrayParser.readDouble(byteArray, 4)).toBe(98765.4375);
      expect(bigEndianByteArrayParser.readFloat(byteArray, 0)).toBe(-64.125);
    });

    it('cross-parser reads do not leak state between the two scratch buffers', () => {
      // Arrange - same value encoded in both endiannesses
      const byteArray = new Uint8Array(8);
      const view = new DataView(byteArray.buffer);

      view.setFloat32(0, 42.625, false); // big endian
      view.setFloat32(4, 42.625, true); // little endian

      // Act / Assert
      expect(bigEndianByteArrayParser.readFloat(byteArray, 0)).toBe(42.625);
      expect(littleEndianByteArrayParser.readFloat(byteArray, 4)).toBe(42.625);
      expect(bigEndianByteArrayParser.readFloat(byteArray, 0)).toBe(42.625);
    });

  });

});
