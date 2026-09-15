/**
 * Internal helper functions for parsing different types from a little-endian byte array
 */

// shared scratch buffer for float/double reads; bytes are copied in on every
// read so no state leaks between calls
const scratchBuffer = new ArrayBuffer(8);
const scratchBytes = new Uint8Array(scratchBuffer);
const scratchFloat = new Float32Array(scratchBuffer);
const scratchDouble = new Float64Array(scratchBuffer);

export default {

  /**
   *
   * Parses an unsigned int 16 from a little-endian byte array
   *
   * @param byteArray the byte array to read from
   * @param position the position in the byte array to read from
   * @returns {*} the parsed unsigned int 16
   * @throws error if buffer overread would occur
   * @access private
   */
  readUint16 (byteArray, position) {
    if (position < 0) {
      throw 'littleEndianByteArrayParser.readUint16: position cannot be less than 0';
    }

    if (position + 2 > byteArray.length) {
      throw 'littleEndianByteArrayParser.readUint16: attempt to read past end of buffer';
    }

    return byteArray[position] + (byteArray[position + 1] * 256);
  },

  /**
   *
   * Parses a signed int 16 from a little-endian byte array
   *
   * @param byteArray the byte array to read from
   * @param position the position in the byte array to read from
   * @returns {*} the parsed signed int 16
   * @throws error if buffer overread would occur
   * @access private
   */
  readInt16 (byteArray, position) {
    if (position < 0) {
      throw 'littleEndianByteArrayParser.readInt16: position cannot be less than 0';
    }
    if (position + 2 > byteArray.length) {
      throw 'littleEndianByteArrayParser.readInt16: attempt to read past end of buffer';
    }

    let int16 = byteArray[position] + (byteArray[position + 1] << 8);

    // fix sign
    if (int16 & 0x8000) {
      int16 = int16 - 0xFFFF - 1;
    }

    return int16;
  },


  /**
   * Parses an unsigned int 32 from a little-endian byte array
   *
   * @param byteArray the byte array to read from
   * @param position the position in the byte array to read from
   * @returns {*} the parsed unsigned int 32
   * @throws error if buffer overread would occur
   * @access private
   */
  readUint32 (byteArray, position) {
    if (position < 0) {
      throw 'littleEndianByteArrayParser.readUint32: position cannot be less than 0';
    }

    if (position + 4 > byteArray.length) {
      throw 'littleEndianByteArrayParser.readUint32: attempt to read past end of buffer';
    }

    return (byteArray[position] +
           (byteArray[position + 1] * 256) +
           (byteArray[position + 2] * 256 * 256) +
           (byteArray[position + 3] * 256 * 256 * 256));
  },

  /**
 * Parses a signed int 32 from a little-endian byte array
 *
 * @param byteArray the byte array to read from
 * @param position the position in the byte array to read from
   * @returns {*} the parsed unsigned int 32
   * @throws error if buffer overread would occur
   * @access private
   */
  readInt32 (byteArray, position) {
    if (position < 0) {
      throw 'littleEndianByteArrayParser.readInt32: position cannot be less than 0';
    }

    if (position + 4 > byteArray.length) {
      throw 'littleEndianByteArrayParser.readInt32: attempt to read past end of buffer';
    }

    return (byteArray[position] +
           (byteArray[position + 1] << 8) +
           (byteArray[position + 2] << 16) +
           (byteArray[position + 3] << 24));
  },

  /**
   * Parses 32-bit float from a little-endian byte array
   *
   * @param byteArray the byte array to read from
   * @param position the position in the byte array to read from
   * @returns {*} the parsed 32-bit float
   * @throws error if buffer overread would occur
   * @access private
   */
  readFloat (byteArray, position) {
    if (position < 0) {
      throw 'littleEndianByteArrayParser.readFloat: position cannot be less than 0';
    }

    if (position + 4 > byteArray.length) {
      throw 'littleEndianByteArrayParser.readFloat: attempt to read past end of buffer';
    }

    scratchBytes[0] = byteArray[position];
    scratchBytes[1] = byteArray[position + 1];
    scratchBytes[2] = byteArray[position + 2];
    scratchBytes[3] = byteArray[position + 3];

    return scratchFloat[0];
  },

  /**
   * Parses 64-bit float from a little-endian byte array
   *
   * @param byteArray the byte array to read from
   * @param position the position in the byte array to read from
   * @returns {*} the parsed 64-bit float
   * @throws error if buffer overread would occur
   * @access private
   */
  readDouble (byteArray, position) {
    if (position < 0) {
      throw 'littleEndianByteArrayParser.readDouble: position cannot be less than 0';
    }

    if (position + 8 > byteArray.length) {
      throw 'littleEndianByteArrayParser.readDouble: attempt to read past end of buffer';
    }

    scratchBytes[0] = byteArray[position];
    scratchBytes[1] = byteArray[position + 1];
    scratchBytes[2] = byteArray[position + 2];
    scratchBytes[3] = byteArray[position + 3];
    scratchBytes[4] = byteArray[position + 4];
    scratchBytes[5] = byteArray[position + 5];
    scratchBytes[6] = byteArray[position + 6];
    scratchBytes[7] = byteArray[position + 7];

    return scratchDouble[0];
  }
};
