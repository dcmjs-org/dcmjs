/**
 * Internal helper functions for parsing different types from a big-endian byte array
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
     * Parses an unsigned int 16 from a big-endian byte array
     *
     * @param byteArray the byte array to read from
     * @param position the position in the byte array to read from
     * @returns {*} the parsed unsigned int 16
     * @throws error if buffer overread would occur
     * @access private
     */
  readUint16 (byteArray, position) {
    if (position < 0) {
      throw 'bigEndianByteArrayParser.readUint16: position cannot be less than 0';
    }
    if (position + 2 > byteArray.length) {
      throw 'bigEndianByteArrayParser.readUint16: attempt to read past end of buffer';
    }

    return (byteArray[position] << 8) + byteArray[position + 1];
  },

  /**
     *
     * Parses a signed int 16 from a big-endian byte array
     *
     * @param byteArray the byte array to read from
     * @param position the position in the byte array to read from
     * @returns {*} the parsed signed int 16
     * @throws error if buffer overread would occur
     * @access private
     */
  readInt16 (byteArray, position) {
    if (position < 0) {
      throw 'bigEndianByteArrayParser.readInt16: position cannot be less than 0';
    }
    if (position + 2 > byteArray.length) {
      throw 'bigEndianByteArrayParser.readInt16: attempt to read past end of buffer';
    }
    var int16 = (byteArray[position] << 8) + byteArray[position + 1];
    // fix sign

    if (int16 & 0x8000) {
      int16 = int16 - 0xFFFF - 1;
    }

    return int16;
  },

  /**
     * Parses an unsigned int 32 from a big-endian byte array
     *
     * @param byteArray the byte array to read from
     * @param position the position in the byte array to read from
     * @returns {*} the parsed unsigned int 32
     * @throws error if buffer overread would occur
     * @access private
     */
  readUint32 (byteArray, position) {
    if (position < 0) {
      throw 'bigEndianByteArrayParser.readUint32: position cannot be less than 0';
    }

    if (position + 4 > byteArray.length) {
      throw 'bigEndianByteArrayParser.readUint32: attempt to read past end of buffer';
    }

    var uint32 = (256 * (256 * (256 * byteArray[position] +
                                          byteArray[position + 1]) +
                                          byteArray[position + 2]) +
                                          byteArray[position + 3]);

    return uint32;
  },

  /**
     * Parses a signed int 32 from a big-endian byte array
     *
     * @param byteArray the byte array to read from
     * @param position the position in the byte array to read from
     * @returns {*} the parsed signed int 32
     * @throws error if buffer overread would occur
     * @access private
     */
  readInt32 (byteArray, position) {
    if (position < 0) {
      throw 'bigEndianByteArrayParser.readInt32: position cannot be less than 0';
    }

    if (position + 4 > byteArray.length) {
      throw 'bigEndianByteArrayParser.readInt32: attempt to read past end of buffer';
    }

    var int32 = ((byteArray[position] << 24) +
                     (byteArray[position + 1] << 16) +
                     (byteArray[position + 2] << 8) +
                      byteArray[position + 3]);

    return int32;
  },

  /**
     * Parses 32-bit float from a big-endian byte array
     *
     * @param byteArray the byte array to read from
     * @param position the position in the byte array to read from
     * @returns {*} the parsed 32-bit float
     * @throws error if buffer overread would occur
     * @access private
     */
  readFloat (byteArray, position) {
    if (position < 0) {
      throw 'bigEndianByteArrayParser.readFloat: position cannot be less than 0';
    }

    if (position + 4 > byteArray.length) {
      throw 'bigEndianByteArrayParser.readFloat: attempt to read past end of buffer';
    }

    scratchBytes[3] = byteArray[position];
    scratchBytes[2] = byteArray[position + 1];
    scratchBytes[1] = byteArray[position + 2];
    scratchBytes[0] = byteArray[position + 3];

    return scratchFloat[0];
  },

  /**
     * Parses 64-bit float from a big-endian byte array
     *
     * @param byteArray the byte array to read from
     * @param position the position in the byte array to read from
     * @returns {*} the parsed 64-bit float
     * @throws error if buffer overread would occur
     * @access private
     */
  readDouble (byteArray, position) {
    if (position < 0) {
      throw 'bigEndianByteArrayParser.readDouble: position cannot be less than 0';
    }

    if (position + 8 > byteArray.length) {
      throw 'bigEndianByteArrayParser.readDouble: attempt to read past end of buffer';
    }

    scratchBytes[7] = byteArray[position];
    scratchBytes[6] = byteArray[position + 1];
    scratchBytes[5] = byteArray[position + 2];
    scratchBytes[4] = byteArray[position + 3];
    scratchBytes[3] = byteArray[position + 4];
    scratchBytes[2] = byteArray[position + 5];
    scratchBytes[1] = byteArray[position + 6];
    scratchBytes[0] = byteArray[position + 7];

    return scratchDouble[0];
  }
};
