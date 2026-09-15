import DataSet from '../src/dataSet';
import littleEndianByteArrayParser from '../src/littleEndianByteArrayParser';
import explicitDataSetToJS from '../src/util/dataSetToJS';

describe('DataSet accessor footguns', () => {

  function stringToBytes(str) {
    const bytes = new Uint8Array(str.length);

    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i);
    }

    return bytes;
  }

  function makeStringDataSet(str, tag, extraElementProps) {
    const byteArray = stringToBytes(str);
    const elements = {};

    elements[tag] = Object.assign({
      tag,
      dataOffset: 0,
      length: byteArray.length
    }, extraElementProps);

    return new DataSet(littleEndianByteArrayParser, byteArray, elements);
  }

  describe('string() with cached element.Value', () => {
    const tag = 'x00100020';

    it('returns the full cached Value when index is undefined', () => {
      const dataSet = makeStringDataSet('IGNORED', tag, { Value: 'ABC\\DEF\\GHI' });

      expect(dataSet.string(tag)).toBe('ABC\\DEF\\GHI');
    });

    it('returns the trimmed component at the requested index', () => {
      const dataSet = makeStringDataSet('IGNORED', tag, { Value: 'ABC \\ DEF\\GHI ' });

      expect(dataSet.string(tag, 0)).toBe('ABC');
      expect(dataSet.string(tag, 1)).toBe('DEF');
      expect(dataSet.string(tag, 2)).toBe('GHI');
    });

    it('returns undefined when the index is out of range', () => {
      const dataSet = makeStringDataSet('IGNORED', tag, { Value: 'ABC\\DEF' });

      expect(dataSet.string(tag, 2)).toBeUndefined();
      expect(dataSet.string(tag, 99)).toBeUndefined();
    });
  });

  describe('string() out-of-range index', () => {
    const tag = 'x00181063';

    it('returns components in range and undefined out of range', () => {
      const dataSet = makeStringDataSet(' 1.2\\2.3  ', tag);

      expect(dataSet.string(tag, 0)).toBe('1.2');
      expect(dataSet.string(tag, 1)).toBe('2.3');
      expect(dataSet.string(tag, 2)).toBeUndefined();
      expect(dataSet.string(tag, 99)).toBeUndefined();
    });

    it('still returns the full trimmed string when index is undefined', () => {
      const dataSet = makeStringDataSet(' 1.2\\2.3  ', tag);

      expect(dataSet.string(tag)).toBe('1.2\\2.3');
    });
  });

  describe('text() out-of-range index', () => {
    const tag = 'x00081030';

    it('returns components in range and undefined out of range', () => {
      const dataSet = makeStringDataSet(' abc\\def  ', tag);

      expect(dataSet.text(tag, 0)).toBe(' abc');
      expect(dataSet.text(tag, 1)).toBe('def');
      expect(dataSet.text(tag, 2)).toBeUndefined();
      expect(dataSet.text(tag, 99)).toBeUndefined();
    });
  });

  describe('explicitDataSetToJS omitPrivateAttributes option', () => {
    const publicTag = 'x00080060';
    const privateTag = 'x00090010';

    function makeMixedDataSet() {
      const byteArray = stringToBytes('CTACME');
      const elements = {};

      elements[publicTag] = { tag: publicTag, vr: 'CS', dataOffset: 0, length: 2 };
      elements[privateTag] = { tag: privateTag, vr: 'LO', dataOffset: 2, length: 4 };

      return new DataSet(littleEndianByteArrayParser, byteArray, elements);
    }

    it('omits private tags by default', () => {
      const result = explicitDataSetToJS(makeMixedDataSet());

      expect(result[publicTag]).toBe('CT');
      expect(result[privateTag]).toBeUndefined();
    });

    it('omits private tags when omitPrivateAttributes is true', () => {
      const result = explicitDataSetToJS(makeMixedDataSet(), {
        omitPrivateAttributes: true,
        maxElementLength: 128
      });

      expect(result[publicTag]).toBe('CT');
      expect(result[privateTag]).toBeUndefined();
    });

    it('includes private tags when omitPrivateAttributes is false', () => {
      const result = explicitDataSetToJS(makeMixedDataSet(), {
        omitPrivateAttributes: false,
        maxElementLength: 128
      });

      expect(result[publicTag]).toBe('CT');
      expect(result[privateTag]).toBe('ACME');
    });
  });
});
