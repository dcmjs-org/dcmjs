import ByteStream from '../src/byteStream';
import readDicomElementExplicit from '../src/readDicomElementExplicit';
import littleEndianByteArrayParser from '../src/littleEndianByteArrayParser';
import parseDicom from '../src/parseDicom';

// Regression tests for H1: the VR byte-pair lookup lacked UV, SV and OV
// (DICOM 2019+ VRs with reserved + 4 byte length framing) and the
// unknown-VR fallback assumed a 2 byte length field. Either case desynced
// the element stream and fabricated phantom elements from value bytes.
describe('UV/SV/OV and unknown VR framing (explicit LE)', () => {

  // builds an explicit little endian stream with one reserved + 4 byte
  // length element (8 byte value) followed by a normal Rows (0028,0010)
  // US element with value 512
  function makeTwoElementStream(groupLo, groupHi, elemLo, elemHi, vr) {
    const byteArray = new Uint8Array([
      groupLo, groupHi, elemLo, elemHi, // tag
      vr.charCodeAt(0), vr.charCodeAt(1), // VR
      0x00, 0x00, // reserved bytes
      0x08, 0x00, 0x00, 0x00, // 4 byte length = 8
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, // 8 byte value

      // following element: Rows (0028,0010) US 2 = 512
      0x28, 0x00, 0x10, 0x00,
      0x55, 0x53, // US
      0x02, 0x00, // 2 byte length = 2
      0x00, 0x02, // 512 little endian
    ]);

    return new ByteStream(littleEndianByteArrayParser, byteArray);
  }

  function assertFirstElementFraming(element, expectedTag, expectedVr) {
    expect(element.tag).toBe(expectedTag);
    expect(element.vr).toBe(expectedVr);
    expect(element.length).toBe(8);
    expect(element.dataOffset).toBe(12); // tag(4) + vr(2) + reserved(2) + length(4)
    expect(element.endOffset).toBe(20);
  }

  function assertFollowingRowsElement(byteStream) {
    const element = readDicomElementExplicit(byteStream);

    expect(element.tag).toBe('x00280010');
    expect(element.vr).toBe('US');
    expect(element.length).toBe(2);
    expect(element.dataOffset).toBe(28);
    expect(element.endOffset).toBe(30);
    expect(littleEndianByteArrayParser.readUint16(byteStream.byteArray, element.dataOffset)).toBe(512);
  }

  it('should frame a UV element with reserved + 4 byte length and not desync the following element', () => {
    // Arrange - (0018,9219) UV with an 8 byte value
    const byteStream = makeTwoElementStream(0x18, 0x00, 0x19, 0x92, 'UV');

    // Act
    const element = readDicomElementExplicit(byteStream);

    // Assert
    assertFirstElementFraming(element, 'x00189219', 'UV');
    assertFollowingRowsElement(byteStream);
  });

  it('should frame an SV element with reserved + 4 byte length and not desync the following element', () => {
    // Arrange - (0018,9920) SV with an 8 byte value
    const byteStream = makeTwoElementStream(0x18, 0x00, 0x20, 0x99, 'SV');

    // Act
    const element = readDicomElementExplicit(byteStream);

    // Assert
    assertFirstElementFraming(element, 'x00189920', 'SV');
    assertFollowingRowsElement(byteStream);
  });

  it('should frame an OV element (Extended Offset Table) with reserved + 4 byte length and not desync the following element', () => {
    // Arrange - (7FE0,0001) Extended Offset Table OV with one 64 bit offset
    const byteStream = makeTwoElementStream(0xE0, 0x7F, 0x01, 0x00, 'OV');

    // Act
    const element = readDicomElementExplicit(byteStream);

    // Assert
    assertFirstElementFraming(element, 'x7fe00001', 'OV');
    assertFollowingRowsElement(byteStream);
  });

  it('should frame an unknown VR with eager-aligned UN framing (reserved + 4 byte length) and not desync the following element', () => {
    // intentional divergence from upstream dicom-parser, which assumed a
    // 2 byte length field for unknown VRs; dcmjs's eager reader uses
    // reserved + 4 byte framing for any VR it does not recognize
    // Arrange - (0018,9219) with a made up VR of ZZ
    const byteStream = makeTwoElementStream(0x18, 0x00, 0x19, 0x92, 'ZZ');

    // Act
    const element = readDicomElementExplicit(byteStream);

    // Assert
    assertFirstElementFraming(element, 'x00189219', 'ZZ');
    assertFollowingRowsElement(byteStream);
  });

  it('should keep framing item/sequence delimitation tags as tag + 4 byte length (no VR bytes)', () => {
    // delimitation tags (group FFFE) carry no VR in any transfer syntax;
    // the old 2 byte unknown-VR fallback consumed them correctly by accident
    // and the UN-style fallback must not break them
    // Arrange - explicit LE: SQ of undefined length with one item of
    // undefined length ended by an item delimitation item, then the sequence
    // delimitation item, then a normal element
    const byteArray = new Uint8Array([
      0x08, 0x00, 0x15, 0x11, // (0008,1115)
      0x53, 0x51, // SQ
      0x00, 0x00, // reserved
      0xFF, 0xFF, 0xFF, 0xFF, // undefined length

      0xFE, 0xFF, 0x00, 0xE0, // item (FFFE,E000)
      0xFF, 0xFF, 0xFF, 0xFF, // undefined length

      0x28, 0x00, 0x10, 0x00, // Rows (0028,0010) US 2 = 512
      0x55, 0x53,
      0x02, 0x00,
      0x00, 0x02,

      0xFE, 0xFF, 0x0D, 0xE0, // item delimitation (FFFE,E00D)
      0x00, 0x00, 0x00, 0x00,

      0xFE, 0xFF, 0xDD, 0xE0, // sequence delimitation (FFFE,E0DD)
      0x00, 0x00, 0x00, 0x00,

      0x28, 0x00, 0x11, 0x00, // Columns (0028,0011) US 2 = 256
      0x55, 0x53,
      0x02, 0x00,
      0x00, 0x01,
    ]);
    const byteStream = new ByteStream(littleEndianByteArrayParser, byteArray);

    // Act
    const sq = readDicomElementExplicit(byteStream, []);

    // Assert - the sequence and its delimiters framed correctly
    expect(sq.tag).toBe('x00081115');
    expect(sq.vr).toBe('SQ');
    expect(sq.items.length).toBe(1);
    expect(sq.items[0].dataSet.elements.x00280010.length).toBe(2);

    const itemDelimiter = sq.items[0].dataSet.elements.xfffee00d;

    expect(itemDelimiter.length).toBe(0);
    expect(itemDelimiter.dataOffset).toBe(itemDelimiter.startOffset + 8);

    expect(sq.endOffset).toBe(46); // consumed through the sequence delimitation item

    // the following element parses correctly
    const next = readDicomElementExplicit(byteStream);

    expect(next.tag).toBe('x00280011');
    expect(next.vr).toBe('US');
    expect(next.length).toBe(2);
    expect(littleEndianByteArrayParser.readUint16(byteStream.byteArray, next.dataOffset)).toBe(256);
  });

  describe('parseDicom with UV/SV/OV elements in a Part 10 buffer', () => {

    function makePart10WithUvSvOv() {
      const rawData = [
        // Preamble (128 zero bytes)
        ...new Array(128).fill(0x00),
        // Prefix
        0x44, 0x49, 0x43, 0x4D,
        // File Meta Information Group Length
        // x00020000          UL         4
        0x02, 0x00, 0x00, 0x00, 0x55, 0x4C, 0x04, 0x00, 0x9F, 0x00, 0x00, 0x00,
        // File Meta Information Version
        // x00020001          OB        (reserved)  2                     01
        0x02, 0x00, 0x01, 0x00, 0x4F, 0x42, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x01,
        // Media Storage SOP Class UID
        // x00020002          UI         26         1.2.840.10008.5.1.4.1.1.2 (CT)
        0x02, 0x00, 0x02, 0x00, 0x55, 0x49, 0x1A, 0x00, 0x31, 0x2E, 0x32, 0x2E, 0x38, 0x34, 0x30, 0x2E, 0x31, 0x30, 0x30, 0x30, 0x38, 0x2E, 0x35, 0x2E, 0x31, 0x2E, 0x34, 0x2E, 0x31, 0x2E, 0x31, 0x2E, 0x32, 0x00,
        // Media Storage SOP Instance UID
        // x00020003          UI         40         1.2.840.113704.1.111.3512.1336285465.198
        0x02, 0x00, 0x03, 0x00, 0x55, 0x49, 0x28, 0x00, 0x31, 0x2E, 0x32, 0x2E, 0x38, 0x34, 0x30, 0x2E, 0x31, 0x31, 0x33, 0x37, 0x30, 0x34, 0x2E, 0x31, 0x2E, 0x31, 0x31, 0x31, 0x2E, 0x33, 0x35, 0x31, 0x32, 0x2E, 0x31, 0x33, 0x33, 0x36, 0x32, 0x38, 0x35, 0x34, 0x36, 0x35, 0x2E, 0x31, 0x39, 0x38,
        // Transfer Syntax UID
        // x00020010          UI         20         1.2.840.10008.1.2.1 (Explicit VR Little Endian)
        0x02, 0x00, 0x10, 0x00, 0x55, 0x49, 0x14, 0x00, 0x31, 0x2E, 0x32, 0x2E, 0x38, 0x34, 0x30, 0x2E, 0x31, 0x30, 0x30, 0x30, 0x38, 0x2E, 0x31, 0x2E, 0x32, 0x2E, 0x31, 0x00,
        // Implementation Class UID
        // x00020012          UI         28         1.2.276.0.7230010.3.0.3.6.0
        0x02, 0x00, 0x12, 0x00, 0x55, 0x49, 0x1C, 0x00, 0x31, 0x2E, 0x32, 0x2E, 0x32, 0x37, 0x36, 0x2E, 0x30, 0x2E, 0x37, 0x32, 0x33, 0x30, 0x30, 0x31, 0x30, 0x2E, 0x33, 0x2E, 0x30, 0x2E, 0x33, 0x2E, 0x36, 0x2E, 0x30, 0x00,

        // x00189219          UV        (reserved)  8                     0x0807060504030201
        0x18, 0x00, 0x19, 0x92, 0x55, 0x56, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        // x00189920          SV        (reserved)  8                     -2 (two's complement)
        0x18, 0x00, 0x20, 0x99, 0x53, 0x56, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0xFE, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        // Slice Location
        // x00201041          DS         4          '-43'
        0x20, 0x00, 0x41, 0x10, 0x44, 0x53, 0x04, 0x00, 0x2D, 0x34, 0x33, 0x00,
        // Rows
        // x00280010          US         2          512
        0x28, 0x00, 0x10, 0x00, 0x55, 0x53, 0x02, 0x00, 0x00, 0x02,
        // Extended Offset Table
        // x7fe00001          OV        (reserved)  8                     one 64 bit offset of 0
        0xE0, 0x7F, 0x01, 0x00, 0x4F, 0x56, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ];

      return new Uint8Array(rawData);
    }

    it('should parse UV/SV/OV defined lengths and keep the rest of the dataset in sync', () => {
      // Arrange
      const byteArray = makePart10WithUvSvOv();

      // Act
      const dataSet = parseDicom(byteArray);

      // Assert - exactly the expected dataset elements exist (no phantoms)
      const datasetTags = Object.keys(dataSet.elements).filter((tag) => tag > 'x0002ffff').sort();

      expect(datasetTags).toEqual(['x00189219', 'x00189920', 'x00201041', 'x00280010', 'x7fe00001']);

      const uv = dataSet.elements.x00189219;

      expect(uv.vr).toBe('UV');
      expect(uv.length).toBe(8);
      expect(uv.endOffset - uv.dataOffset).toBe(8);

      const sv = dataSet.elements.x00189920;

      expect(sv.vr).toBe('SV');
      expect(sv.length).toBe(8);
      expect(sv.endOffset - sv.dataOffset).toBe(8);

      const ov = dataSet.elements.x7fe00001;

      expect(ov.vr).toBe('OV');
      expect(ov.length).toBe(8);
      expect(ov.endOffset - ov.dataOffset).toBe(8);

      // elements after the UV/SV/OV elements parsed without desync
      expect(dataSet.uint16('x00280010')).toBe(512);
      expect(dataSet.string('x00201041')).toBe('-43');
    });

  });

});
