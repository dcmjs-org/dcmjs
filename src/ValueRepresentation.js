import { ReadBufferStream, WriteBufferStream } from "./BufferStream.js";
import { PN_COMPONENT_DELIMITER, VM_DELIMITER } from "./constants/dicom.js";
import { defaultPadding, padBytes } from "./constants/padding";
import { log, validationLog } from "./log.js";
import dicomJson from "./utilities/dicomJson.js";

// We replace the tag with a Proxy which intercepts assignments to obj[valueProp]
// and adds additional overrides/accessors to the value if need be. If valueProp
// is falsy, we check target.vr and add accessors via a ValueRepresentation lookup.
// Specifically, this helps address the incorrect (though common) use of the library:
//   dicomDict.dict.upsertTag('00101001', 'PN', 'Doe^John'); /* direct string assignment */
//   dicomDict.dict['00081070'].Value = 'Doe^John\Doe^Jane'; /* overwrite with multiplicity */
//   ...
//   jsonOutput = JSON.serialize(dicomDict);
// or:
//   naturalizedDataset.OperatorsName = 'Doe^John';
//   jsonOutput = JSON.serialize(naturalizedDataset);
// Whereas the correct usage of the dicom+json model would be:
//   dicomDict.dict.upsertTag('00101001', 'PN', [{Alphabetic:'Doe^John'}]);
//   naturalizedDataset.OperatorsName = [{Alphabetic:'Doe^John'},{Alphabetic:'Doe^Jane'}];
// TODO: refactor with addAccessors.js in mind
const tagProxyHandler = {
    set(target, prop, value) {
        var vrType;
        if (
            ["values", "Value"].includes(prop) &&
            target.vr &&
            ValueRepresentation.hasValueAccessors(target.vr)
        ) {
            vrType = ValueRepresentation.createByTypeString(target.vr);
        } else if (
            prop in DicomMetaDictionary.nameMap &&
            ValueRepresentation.hasValueAccessors(
                DicomMetaDictionary.nameMap[prop].vr
            )
        ) {
            vrType = ValueRepresentation.createByTypeString(
                DicomMetaDictionary.nameMap[prop].vr
            );
        } else {
            target[prop] = value;
            return true;
        }

        target[prop] = vrType.addValueAccessors(value);

        return true;
    }
};

function rtrim(str) {
    return str.replace(/\s*$/g, "");
}

function toWindows(inputArray, size) {
    return Array.from(
        { length: inputArray.length - (size - 1) }, //get the appropriate length
        (_, index) => inputArray.slice(index, index + size) //create the windows
    );
}

let DicomMessage, Tag, DicomMetaDictionary;

var binaryVRs = ["FL", "FD", "SL", "SS", "UL", "US", "AT", "UV"],
    length32VRs = ["OB", "OW", "OF", "SQ", "UC", "UR", "UT", "UN", "OD", "UV"],
    singleVRs = ["SQ", "OF", "OW", "OB", "UN"];

/**
 * ## [6.2 Value Representation (VR)](https://dicom.nema.org/medical/dicom/current/output/html/part05.html#sect_6.2)
 * The Value Representation of a Data Element describes the data type and format of that Data Element's Value(s).
 * [PS3.6](https://dicom.nema.org/medical/dicom/current/output/html/part06.html#PS3.6) lists the VR of each Data Element by
 * Data Element Tag.
 *
 * **Values with VRs constructed of character strings, except in the case of the VR UI, shall be padded with SPACE
 * characters (20H, in the Default Character Repertoire) when necessary to achieve even length. Values with a VR
 * of UI shall be padded with a single trailing NULL (00H) character when necessary to achieve even length.
 * Values with a VR of OB shall be padded with a single trailing NULL byte value (00H) when necessary to achieve
 * even length.**
 *
 * All new VRs defined in future versions of DICOM shall be of the same Data Element Structure as defined in
 * [Section 7.1.2](https://dicom.nema.org/medical/dicom/current/output/html/part05.html#sect_7.1.2)
 * (i.e., following the format for VRs such as OB, OW, SQ and UN).
 *
 * ### Note
 *
 * 1. *Since all new VRs will be defined as specified in
 * [Section 7.1.2](https://dicom.nema.org/medical/dicom/current/output/html/part05.html#sect_7.1.2), an
 * implementation may choose to ignore VRs not recognized by applying the rules stated in
 * [Section 7.1.2](https://dicom.nema.org/medical/dicom/current/output/html/part05.html#sect_7.1.2).*
 *
 * 2. *When converting a Data Set from an Explicit VR Transfer Syntax to a different Transfer Syntax, an
 * implementation may copy Data Elements with unrecognized VRs in the following manner:*
 *      -   *If the endianness of the Transfer Syntaxes is the same, the Value of the Data Element may be copied
 *      unchanged and if the target Transfer Syntax is Explicit VR, the VR bytes copied unchanged. In practice
 *      this only applies to Little Endian Transfer Syntaxes, since there was only one Big Endian Transfer Syntax
 *      defined.*
 *      -   *If the source Transfer Syntax is Little Endian and the target Transfer Syntax is the (retired)
 *      Big Endian Explicit VR Transfer Syntax, then the Value of the Data Element may be copied unchanged and
 *      the VR changed to UN, since being unrecognized, whether or not byte swapping is required is unknown. If the
 *      VR were copied unchanged, the byte order of the Value might or might not be incorrect.*
 *      -   *If the source Transfer Syntax is the (retired) Big Endian Explicit VR Transfer Syntax, then the
 *      Data Element cannot be copied, because whether or not byte swapping is required is unknown, and there is
 *      no equivalent of the UN VR to use when the Value is big endian rather than little endian.*
 *
 * *The issues of whether or not the Data Element may be copied, and what VR to use if copying, do not arise when
 * converting a Data Set from Implicit VR Little Endian Transfer Syntax, since the VR would not be present to be
 * unrecognized, and if the Data Element VR is not known from a data dictionary, then UN would be used.*
 *
 * An individual Value, including padding, shall not exceed the Length of Value, except in the case of the last
 * Value of a multi-valued field as specified in [Section 6.4](https://dicom.nema.org/medical/dicom/current/output/html/part05.html#sect_6.4).
 *
 *
 * ### Note
 * The lengths of Value Representations for which the Character Repertoire can be extended or replaced are
 * expressly specified in characters rather than bytes in
 * [Table 6.2-1](https://dicom.nema.org/medical/dicom/current/output/html/part05.html#table_6.2-1). This is because
 * the mapping from a character to the number of bytes used for that character's encoding may be dependent on the
 * character set used.
 *
 * Escape Sequences used for Code Extension shall not be included in the count of characters.
 *
 * ### Note
 * 1. *For Data Elements that were present in ACR-NEMA 1.0 and 2.0 and that have been retired, the specifications
 * of Value Representation and Value Multiplicity provided are recommendations for the purpose of interpreting
 * their Values in objects created in accordance with earlier versions of this Standard. These recommendations are
 * suggested as most appropriate for a particular Data Element; however, there is no guarantee that historical
 * objects will not violate some requirements or specified VR and/or VM.*
 *
 * 2. *The length of the Value of UC, UR and UT VRs is limited only by the size of the maximum unsigned integer
 * representable in a 32 bit VL field minus two, since FFFFFFFFH is reserved and lengths are required to be even.*
 *
 * 3. *In previous editions of the Standard (see PS3.5-2015a), the TAB character was not listed as permitted for
 * the ST, LT and UT VRs. It has been added for the convenience of formatting and the encoding of XML text.*
 *
 */
class ValueRepresentation {
    constructor(type) {
        this.type = type;
        this.multi = false;
        this._isBinary = binaryVRs.indexOf(this.type) != -1;
        this._allowMultiple =
            !this._isBinary && singleVRs.indexOf(this.type) == -1;
        this._isLength32 = length32VRs.indexOf(this.type) != -1;
        this._storeRaw = true;
        this._padByte = ValueRepresentation.selectPadByte(type);
    }

    static setDicomMessageClass(dicomMessageClass) {
        DicomMessage = dicomMessageClass;
    }

    static setDicomMetaDictionary(metaDictionary) {
        DicomMetaDictionary = metaDictionary;
    }

    static setTagClass(tagClass) {
        Tag = tagClass;
    }

    static selectPadByte(type) {
        return padBytes.has(type) ? padBytes.get(type) : defaultPadding;
    }

    isBinary() {
        return this._isBinary;
    }

    allowMultiple() {
        return this._allowMultiple;
    }

    /**
     * Returns if the length is 32 bits.  This has nothing to do with being
     * explicit or not, it only has to do with encoding.
     * @deprecated  Replaced by isLength32
     */
    isExplicit() {
        return this._isLength32;
    }

    /**
     * Returns if the length is 32 bits.  This has nothing to do with being
     * explicit or not, it only has to do with encoding.
     *
     * This used to be isExplicit, which was wrong as both encodings are explicit,
     * just one uses a single 4 byte word to encode both VR and length, and
     * the isLength32 always use a separate 32 bit length.
     */
    isLength32() {
        return this._isLength32;
    }

    /**
     * Flag that specifies whether to store the original unformatted value that is read from the dicom input buffer.
     * The `_rawValue` is used for lossless round trip processing, which preserves data (whitespace, special chars) on write
     * that may be lost after casting to other data structures like Number, or applying formatting for readability.
     *
     * Example DecimalString: _rawValue: ["-0.000"], Value: [0]
     */
    storeRaw() {
        return this._storeRaw;
    }

    addValueAccessors(value) {
        return value;
    }

    /**
     * Replaces a tag with a Proxy which assigns value accessors based on the vr field
     * of the tag being given to it. If the tag object does not have a vr or vr.type
     * property, the proxy will look for the prop name in the natural name map.
     * @param {any} tag object to add accessors to
     * @returns {any} either the same object if no accessor needed, or a Proxy
     */
    static addTagAccessors(tag) {
        if (
            !tag.__hasTagAccessors &&
            ValueRepresentation.hasValueAccessors(tag.vr?.type || tag.vr)
        ) {
            Object.defineProperty(tag, "__hasTagAccessors", { value: true });
            // See note in declaration of taxProxyHandler
            return new Proxy(tag, tagProxyHandler);
        }
        return tag;
    }

    /**
     * Removes padding byte, if it exists, from the last value in a multiple-value data element.
     *
     * This function ensures that data elements with multiple values maintain their integrity for lossless
     * read/write operations. In cases where the last value of a multi-valued data element is at the maximum allowed length,
     * an odd-length total can result in a padding byte being added. This padding byte, can cause a length violation
     * when writing back to the file. To prevent this, we remove the padding byte if it is the only additional character
     * in the last element. Otherwise, it leaves the values as-is to minimize changes to the original data.
     *
     * @param {string[]} values - An array of strings representing the values of a DICOM data element.
     * @returns {string[]} The modified array, with the padding byte potentially removed from the last value.
     */
    dropPadByte(values) {
        const maxLength = this.maxLength ?? this.maxCharLength;
        if (!Array.isArray(values) || !maxLength || !this._padByte) {
            return values;
        }

        // Only consider multiple-value data elements, as max length issues arise from a delimiter
        // making the total length odd and necessitating a padding byte.
        if (values.length > 1) {
            const padChar = String.fromCharCode(this._padByte);
            const lastIdx = values.length - 1;
            const lastValue = values[lastIdx];

            // If the last element is odd and ends with the padding byte trim to avoid potential max length violations during write
            if (lastValue.length % 2 !== 0 && lastValue.endsWith(padChar)) {
                values[lastIdx] = lastValue.substring(0, lastValue.length - 1); // Trim the padding byte
            }
        }

        return values;
    }

    read(stream, length, syntax, readOptions = { forceStoreRaw: false }) {
        if (this.fixed && this.maxLength) {
            if (!length)
                return {
                    rawValue: this.defaultValue,
                    value: this.defaultValue
                };
            if (this.maxLength != length)
                log.error(
                    "Invalid length for fixed length tag, vr " +
                        this.type +
                        ", length " +
                        this.maxLength +
                        " != " +
                        length
                );
        }
        let rawValue = this.readBytes(stream, length, syntax);
        const value = this.applyFormatting(rawValue);

        // avoid duplicating large binary data structures like pixel data which are unlikely to be formatted or directly manipulated
        if (!this.storeRaw() && !readOptions.forceStoreRaw) {
            rawValue = undefined;
        }

        return { rawValue, value };
    }

    applyFormatting(value) {
        return value;
    }

    readBytes(stream, length) {
        return super.readPaddedAsciiString(stream, length);
    }

    readPaddedAsciiString(stream, length) {
        if (!length) return "";
        if (stream.peekUint8(length - 1) !== this._padByte || this._storeRaw) {
            return stream.readAsciiString(length);
        } else {
            var val = stream.readAsciiString(length - 1);
            stream.increment(1);
            return val;
        }
    }

    readPaddedEncodedString(stream, length) {
        if (!length) return "";
        const val = stream.readEncodedString(length);
        if (
            (val.length &&
                val[val.length - 1] !== String.fromCharCode(this._padByte)) ||
            this._storeRaw
        ) {
            return val;
        } else {
            return val.slice(0, -1);
        }
    }

    /**
     * Write array of values into stream with `ValueMultiplicity Delimiter`.
     *
     * ### Cases & Expected Behavior:
     *
     *  - If `value` is an `Array`:
     *      - with `valueArgs = ["1.2.840.10008.1.2.1"]` => `singularArgs = Array(1) [1.2.840.10008.1.2.1]`
     *      - with `valueArgs = ["1.2.840.10008.1.2.1"]` and `multiplicity = true` => `Array(1) [1.2.840.10008.1.2.1]`, `buffer => "1.2.840.10008.1.2.1"`
     *      - with `valueArgs = ["5", "10"]` and `multiplicity = true` => `Array(1) ["5", "10"]`, `buffer => "5\\10"`
     *  - Else:
     *      - **write value**
     *
     * @param {BufferStream} stream
     * @param {string} type
     * @param {any | any[]} value
     * @returns {*[]}
     */
    write(stream, type, value) {
        const func = stream["write" + type];
        let written = 0;

        if (value === null || value === "" || value === undefined) {
            return stream.writeAsciiString("");
        } else {
            if (Array.isArray(value)) {
                if (value.length >= 1) {
                    const self = this;
                    value.forEach(function (v, k) {
                        if (self.allowMultiple() && k > 0) {
                            stream.writeUint8(VM_DELIMITER);
                            written++;
                        }
                        written += func.apply(stream, [v]);
                    });
                }
            } else {
                written += func.apply(stream, [value]);
            }
            return written;
        }
    }

    /**
     * Method for validating value size and writing padding bytes as needed.
     *
     * **Values with VRs constructed of character strings, except in the case of the VR UI, shall be padded with SPACE
     * characters (20H, in the Default Character Repertoire) when necessary to achieve even length. Values with a VR
     * of UI shall be padded with a single trailing NULL (00H) character when necessary to achieve even length.
     * Values with a VR of OB shall be padded with a single trailing NULL byte value (00H) when necessary to achieve
     * even length.**
     *
     * @param {BufferStream} stream
     * @param {any} value
     * @param {number} length
     * @param {Object} writeOptions
     * @returns {number}
     */
    writeBytes(
        stream,
        value,
        length,
        writeOptions = { allowInvalidVRLength: false }
    ) {
        const { allowInvalidVRLength } = writeOptions;
        // Probably should be false by default and then truly confirm sizes.
        let valid = value === null || allowInvalidVRLength,
            total = 0;

        let isString = false;
        if (this.checkLength) {
            valid = this.checkLength(value);
        } else if (this.maxCharLength) {
            valid = length <= this.maxCharLength;
            isString = true;
        } else if (this.maxLength) {
            valid = length <= this.maxLength;
        }

        if (!valid) {
            const errmsg =
                "Value exceeds max length, vr: " +
                this.type +
                ", value: " +
                value +
                ", length: " +
                length;
            if (isString) log.info(errmsg);
            else throw new Error(errmsg);
        }
        total += length;

        //check for odd
        let written = total;
        if (total & 1 && this._padByte !== null) {
            stream.writeUint8(this._padByte);
            written++;
        }
        return written;
    }

    static hasValueAccessors(type) {
        if (type in VRinstances) {
            return (
                VRinstances[type].addValueAccessors !==
                ValueRepresentation.prototype.addValueAccessors
            );
        }
        // Given undefined, assume the representation need to add value accessors
        return type === undefined;
    }

    static createByTypeString(type) {
        var vr = VRinstances[type];
        if (vr === undefined) {
            if (type == "ox") {
                // TODO: determine VR based on context (could be 1 byte pixel data)
                // https://github.com/dgobbi/vtk-dicom/issues/38
                validationLog.error("Invalid vr type", type, "- using OW");
                vr = VRinstances["OW"];
            } else if (type == "xs") {
                validationLog.error("Invalid vr type", type, "- using US");
                vr = VRinstances["US"];
            } else {
                validationLog.error("Invalid vr type", type, "- using UN");
                vr = VRinstances["UN"];
            }
        }
        return vr;
    }

    static parseUnknownVr(type) {
        return new ParsedUnknownValue(type);
    }
}

class AsciiStringRepresentation extends ValueRepresentation {
    constructor(type) {
        super(type);
    }

    readBytes(stream, length) {
        return super.readPaddedAsciiString(stream, length);
    }

    writeBytes(stream, value, writeOptions) {
        const written = super.write(stream, "AsciiString", value);

        return super.writeBytes(stream, value, written, writeOptions);
    }
}

class EncodedStringRepresentation extends ValueRepresentation {
    constructor(type) {
        super(type);
    }

    readBytes(stream, length) {
        return super.readPaddedEncodedString(stream, length);
    }

    writeBytes(stream, value, writeOptions) {
        const written = super.write(stream, "UTF8String", value);

        return super.writeBytes(stream, value, written, writeOptions);
    }
}

class BinaryRepresentation extends ValueRepresentation {
    constructor(type) {
        super(type);
        this._storeRaw = false;
    }

    writeBytes(stream, value, _syntax, isEncapsulated, writeOptions = {}) {
        var i;
        var binaryStream;
        var { fragmentMultiframe = true } = writeOptions;
        value = value === null || value === undefined ? [] : value;
        if (isEncapsulated) {
            var fragmentSize = 1024 * 20,
                frames = value.length,
                startOffset = [];

            // Calculate a total length for storing binary stream
            var bufferLength = 0;
            for (i = 0; i < frames; i++) {
                const needsPadding = Boolean(value[i].byteLength & 1);
                bufferLength += value[i].byteLength + (needsPadding ? 1 : 0);
                let fragmentsLength = 1;
                if (fragmentMultiframe) {
                    fragmentsLength = Math.ceil(
                        value[i].byteLength / fragmentSize
                    );
                }
                // 8 bytes per fragment are needed to store 0xffff (2 bytes), 0xe000 (2 bytes), and frageStream size (4 bytes)
                bufferLength += fragmentsLength * 8;
            }

            binaryStream = new WriteBufferStream(
                bufferLength,
                stream.isLittleEndian
            );

            for (i = 0; i < frames; i++) {
                const needsPadding = Boolean(value[i].byteLength & 1);

                startOffset.push(binaryStream.size);
                var frameBuffer = value[i],
                    frameStream = new ReadBufferStream(frameBuffer);

                var fragmentsLength = 1;
                if (fragmentMultiframe) {
                    fragmentsLength = Math.ceil(
                        frameStream.size / fragmentSize
                    );
                }

                for (var j = 0, fragmentStart = 0; j < fragmentsLength; j++) {
                    const isFinalFragment = j === fragmentsLength - 1;

                    var fragmentEnd = fragmentStart + frameStream.size;
                    if (fragmentMultiframe) {
                        fragmentEnd = fragmentStart + fragmentSize;
                    }
                    if (isFinalFragment) {
                        fragmentEnd = frameStream.size;
                    }
                    var fragStream = new ReadBufferStream(
                        frameStream.getBuffer(fragmentStart, fragmentEnd)
                    );
                    fragmentStart = fragmentEnd;
                    binaryStream.writeUint16(0xfffe);
                    binaryStream.writeUint16(0xe000);

                    const addPaddingByte = isFinalFragment && needsPadding;

                    binaryStream.writeUint32(
                        fragStream.size + (addPaddingByte ? 1 : 0)
                    );
                    binaryStream.concat(fragStream);

                    if (addPaddingByte) {
                        binaryStream.writeInt8(this._padByte);
                    }
                }
            }

            stream.writeUint16(0xfffe);
            stream.writeUint16(0xe000);
            stream.writeUint32(startOffset.length * 4);
            for (i = 0; i < startOffset.length; i++) {
                stream.writeUint32(startOffset[i]);
            }
            stream.concat(binaryStream);
            stream.writeUint16(0xfffe);
            stream.writeUint16(0xe0dd);
            stream.writeUint32(0x0);

            return 0xffffffff;
        } else {
            var binaryData = value[0];
            binaryStream = new ReadBufferStream(binaryData);
            stream.concat(binaryStream);
            // Make sure we can pass validation of the binary blob since these can be unbounded.
            this.maxLength = Math.max(
                binaryData.byteLength,
                this.maxLength ?? binaryData.byteLength
            );
            return super.writeBytes(
                stream,
                binaryData,
                binaryStream.size,
                writeOptions
            );
        }
    }

    readBytes(stream, length) {
        if (length == 0xffffffff) {
            var itemTagValue = Tag.readTag(stream),
                frames = [];

            if (itemTagValue.is(0xfffee000)) {
                var itemLength = stream.readUint32(),
                    numOfFrames = 1,
                    offsets = [];
                if (itemLength > 0x0) {
                    //has frames
                    numOfFrames = itemLength / 4;
                    var i = 0;
                    while (i++ < numOfFrames) {
                        offsets.push(stream.readUint32());
                    }
                } else {
                    offsets = [];
                }

                const SequenceItemTag = 0xfffee000;
                const SequenceDelimiterTag = 0xfffee0dd;

                const getNextSequenceItemData = stream => {
                    const nextTag = Tag.readTag(stream);
                    if (nextTag.is(SequenceItemTag)) {
                        const itemLength = stream.readUint32();
                        const buffer = stream.getBuffer(
                            stream.offset,
                            stream.offset + itemLength
                        );
                        stream.increment(itemLength);
                        return buffer;
                    } else if (nextTag.is(SequenceDelimiterTag)) {
                        // Read SequenceDelimiterItem value for the SequenceDelimiterTag
                        if (stream.readUint32() !== 0) {
                            throw Error(
                                "SequenceDelimiterItem tag value was not zero"
                            );
                        }
                        return null;
                    }

                    throw Error("Invalid tag in sequence");
                };

                // If there is an offset table, use that to loop through pixel data sequence
                if (offsets.length > 0) {
                    // make offsets relative to the stream, not tag
                    offsets = offsets.map(e => e + stream.offset);
                    offsets.push(stream.size);

                    // window offsets to an array of [start,stop] locations
                    frames = toWindows(offsets, 2).map(range => {
                        const fragments = [];
                        const [start, stop] = range;
                        // create a new readable stream based on the range
                        const rangeStream = new ReadBufferStream(
                            stream.buffer,
                            stream.isLittleEndian,
                            {
                                start: start,
                                stop: stop,
                                noCopy: stream.noCopy
                            }
                        );

                        let frameSize = 0;
                        while (!rangeStream.end()) {
                            const buf = getNextSequenceItemData(rangeStream);
                            if (buf === null) {
                                break;
                            }
                            fragments.push(buf);
                            frameSize += buf.byteLength;
                        }

                        // Ensure the parent stream's offset is kept up to date
                        stream.offset = rangeStream.offset;

                        // If there's only one buffer thne just return it directly
                        if (fragments.length === 1) {
                            return fragments[0];
                        }

                        if (rangeStream.noCopy) {
                            // return the fragments for downstream application to process
                            return fragments;
                        } else {
                            // Allocate a final ArrayBuffer and concat all buffers into it
                            const mergedFrame = new ArrayBuffer(frameSize);
                            const u8Data = new Uint8Array(mergedFrame);
                            fragments.reduce((offset, buffer) => {
                                u8Data.set(new Uint8Array(buffer), offset);
                                return offset + buffer.byteLength;
                            }, 0);

                            return mergedFrame;
                        }
                    });
                }
                // If no offset table, loop through remainder of stream looking for termination tag
                else {
                    while (!stream.end()) {
                        const buffer = getNextSequenceItemData(stream);
                        if (buffer === null) {
                            break;
                        }
                        frames.push(buffer);
                    }
                }
            } else {
                throw new Error(
                    "Item tag not found after undefined binary length"
                );
            }
            return frames;
        } else {
            var bytes;
            /*if (this.type == 'OW') {
                bytes = stream.readUint16Array(length);
            } else if (this.type == 'OB') {
                bytes = stream.readUint8Array(length);
            }*/
            bytes = stream.getBuffer(stream.offset, stream.offset + length);
            stream.increment(length);
            return [bytes];
        }
    }
}

class ApplicationEntity extends AsciiStringRepresentation {
    constructor() {
        super("AE");
        this.maxLength = 16;
    }

    readBytes(stream, length) {
        return super.readPaddedAsciiString(stream, length);
    }

    applyFormatting(value) {
        return value.trim();
    }
}

class CodeString extends AsciiStringRepresentation {
    constructor() {
        super("CS");
        this.maxLength = 16;
    }

    readBytes(stream, length) {
        const BACKSLASH = String.fromCharCode(VM_DELIMITER);
        return this.dropPadByte(
            super.readPaddedAsciiString(stream, length).split(BACKSLASH)
        );
    }

    applyFormatting(value) {
        const trim = str => str.trim();

        if (Array.isArray(value)) {
            return value.map(str => trim(str));
        }

        return trim(value);
    }
}

class AgeString extends AsciiStringRepresentation {
    constructor() {
        super("AS");
        this.maxLength = 4;
        this.fixed = true;
        this.defaultValue = "";
    }
}

class AttributeTag extends ValueRepresentation {
    constructor() {
        super("AT");
        this.maxLength = 4;
        this.valueLength = 4;
        this.fixed = true;
    }

    readBytes(stream) {
        return Tag.readTag(stream).value;
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "TwoUint16s", value),
            writeOptions
        );
    }
}

class DateValue extends AsciiStringRepresentation {
    constructor(value) {
        super("DA", value);
        this.maxLength = 8;
        this.rangeMatchingMaxLength = 18;
        //this.fixed = true;
        this.defaultValue = "";
    }

    checkLength(value) {
        if (typeof value === "string" || value instanceof String) {
            const isRangeQuery = value.includes("-");
            return (
                value.length <=
                (isRangeQuery ? this.rangeMatchingMaxLength : this.maxLength)
            );
        }
        return true;
    }
}

class NumericStringRepresentation extends AsciiStringRepresentation {
    readBytes(stream, length) {
        const BACKSLASH = String.fromCharCode(VM_DELIMITER);
        const numStr = super.readPaddedAsciiString(stream, length);

        return this.dropPadByte(numStr.split(BACKSLASH));
    }
}

class DecimalString extends NumericStringRepresentation {
    constructor() {
        super("DS");
        this.maxLength = 16;
    }

    applyFormatting(value) {
        const formatNumber = numberStr => {
            let returnVal = numberStr.trim().replace(/[^0-9.\\\-+e]/gi, "");
            return returnVal === "" ? null : Number(returnVal);
        };

        if (Array.isArray(value)) {
            return value.map(formatNumber);
        }

        return formatNumber(value);
    }

    convertToString(value) {
        if (value === null) return "";
        if (typeof value === "string") return value;

        let str = String(value);
        if (str.length > this.maxLength) {
            // Characters needed for '-' at start.
            const sign_chars = value < 0 ? 1 : 0;

            // Decide whether to use scientific notation.
            const logval = Math.log10(Math.abs(value));

            // Numbers larger than 1e14 cannot be correctly represented by truncating
            // their string representations to 16 chars, e.g pi * 10^13 would become
            // '314159265358979.', which may not be universally understood. This limit
            // is 1e13 for negative numbers because of the minus sign.
            // For negative exponents, the point of equal precision between scientific
            // and standard notation is 1e-4 e.g. '0.00031415926535' and
            // '3.1415926535e-04' are both 16 chars.
            const use_scientific = logval < -4 || logval >= 14 - sign_chars;
            if (use_scientific) {
                const trunc_str = value.toExponential(16 - sign_chars);
                if (trunc_str.length <= 16) return trunc_str;
                // If string is too long, correct the length.
                return value.toExponential(
                    16 - (trunc_str.length - 16) - sign_chars
                );
            } else {
                const trunc_str = value.toFixed(16 - sign_chars);
                if (trunc_str.length <= 16) return trunc_str;
                // If string is too long, correct the length.
                return value.toFixed(16 - sign_chars - (trunc_str.length - 16));
            }
        }
        return str;
    }

    writeBytes(stream, value, writeOptions) {
        const val = Array.isArray(value)
            ? value.map(ds => this.convertToString(ds))
            : [this.convertToString(value)];
        return super.writeBytes(stream, val, writeOptions);
    }
}

class DateTime extends AsciiStringRepresentation {
    constructor() {
        super("DT");
        this.maxLength = 26;
        this.rangeMatchingMaxLength = 54;
    }

    checkLength(value) {
        if (typeof value === "string" || value instanceof String) {
            const isRangeQuery = value.includes("-");
            return (
                value.length <=
                (isRangeQuery ? this.rangeMatchingMaxLength : this.maxLength)
            );
        }
        return true;
    }
}

class FloatingPointSingle extends ValueRepresentation {
    constructor() {
        super("FL");
        this.maxLength = 4;
        this.fixed = true;
        this.defaultValue = 0.0;
    }

    readBytes(stream) {
        return stream.readFloat();
    }

    applyFormatting(value) {
        return Number(value);
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Float", value),
            writeOptions
        );
    }
}

class FloatingPointDouble extends ValueRepresentation {
    constructor() {
        super("FD");
        this.maxLength = 8;
        this.fixed = true;
        this.defaultValue = 0.0;
    }

    readBytes(stream) {
        return stream.readDouble();
    }

    applyFormatting(value) {
        return Number(value);
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Double", value),
            writeOptions
        );
    }
}

class IntegerString extends NumericStringRepresentation {
    constructor() {
        super("IS");
        this.maxLength = 12;
    }

    applyFormatting(value) {
        const formatNumber = numberStr => {
            let returnVal = numberStr.trim().replace(/[^0-9.\\\-+e]/gi, "");
            return returnVal === "" ? null : Number(returnVal);
        };

        if (Array.isArray(value)) {
            return value.map(formatNumber);
        }

        return formatNumber(value);
    }

    convertToString(value) {
        if (typeof value === "string") return value;
        return value === null ? "" : String(value);
    }

    writeBytes(stream, value, writeOptions) {
        const val = Array.isArray(value)
            ? value.map(is => this.convertToString(is))
            : [this.convertToString(value)];
        return super.writeBytes(stream, val, writeOptions);
    }
}

class LongString extends EncodedStringRepresentation {
    constructor() {
        super("LO");
        this.maxCharLength = 64;
    }

    readBytes(stream, length) {
        return super.readPaddedEncodedString(stream, length);
    }

    applyFormatting(value) {
        return value.trim();
    }
}

class LongText extends EncodedStringRepresentation {
    constructor() {
        super("LT");
        this.maxCharLength = 10240;
    }

    readBytes(stream, length) {
        return super.readPaddedEncodedString(stream, length);
    }

    applyFormatting(value) {
        return rtrim(value);
    }
}

class PersonName extends EncodedStringRepresentation {
    constructor() {
        super("PN");
        this.maxLength = null;
    }

    static checkComponentLengths(components) {
        for (var i in components) {
            var cmp = components[i];
            // As per table 6.2-1 in the spec
            if (cmp.length > 64) return false;
        }
        return true;
    }

    // Adds toJSON and toString accessors to normalize PersonName output; ie toJSON
    // always returns a dicom+json object, and toString always returns a part10
    // style string, regardless of typeof value
    addValueAccessors(value) {
        if (typeof value === "string") {
            value = new String(value);
        }
        if (value != undefined) {
            if (typeof value === "object") {
                return dicomJson.pnAddValueAccessors(value);
            } else {
                throw new Error(
                    "Cannot add accessors to non-string primitives"
                );
            }
        }
        return value;
    }

    // Only checked on write, not on read nor creation
    checkLength(value) {
        if (Array.isArray(value)) {
            // In DICOM JSON, components are encoded as a mapping (object),
            // where the keys are one or more of the following: "Alphabetic",
            // "Ideographic", "Phonetic".
            // http://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_F.2.2.html
            for (const pnValue of value) {
                const components = Object.keys(pnValue).forEach(
                    key => value[key]
                );
                if (!PersonName.checkComponentLengths(components)) return false;
            }
        } else if (typeof value === "string" || value instanceof String) {
            // In DICOM Part10, components are encoded as a string,
            // where components ("Alphabetic", "Ideographic", "Phonetic")
            // are separated by the "=" delimeter.
            // http://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_6.2.html
            // PN may also have multiplicity, with each item separated by
            // 0x5C (backslash).
            // https://dicom.nema.org/dicom/2013/output/chtml/part05/sect_6.4.html
            const values = value.split(String.fromCharCode(VM_DELIMITER));

            for (var pnString of values) {
                const components = pnString.split(
                    String.fromCharCode(PN_COMPONENT_DELIMITER)
                );
                if (!PersonName.checkComponentLengths(components)) return false;
            }
        }
        return true;
    }

    readBytes(stream, length) {
        return this.readPaddedEncodedString(stream, length);
    }

    applyFormatting(value) {
        const parsePersonName = valueStr =>
            dicomJson.pnConvertToJsonObject(valueStr);

        if (Array.isArray(value)) {
            return value.map(valueStr => parsePersonName(valueStr));
        }

        return parsePersonName(value);
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            dicomJson.pnObjectToString(value),
            writeOptions
        );
    }
}

class ShortString extends EncodedStringRepresentation {
    constructor() {
        super("SH");
        this.maxCharLength = 16;
    }

    readBytes(stream, length) {
        return super.readPaddedEncodedString(stream, length);
    }

    applyFormatting(value) {
        return value.trim();
    }
}

class SignedLong extends ValueRepresentation {
    constructor() {
        super("SL");
        this.maxLength = 4;
        this.fixed = true;
        this.defaultValue = 0;
    }

    readBytes(stream) {
        return stream.readInt32();
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Int32", value),
            writeOptions
        );
    }
}

class SequenceOfItems extends ValueRepresentation {
    constructor() {
        super("SQ");
        this.maxLength = null;
        this.noMultiple = true;
        this._storeRaw = false;
    }

    readBytes(stream, sqlength, syntax) {
        if (sqlength == 0x0) {
            return []; //contains no dataset
        } else {
            var undefLength = sqlength == 0xffffffff,
                elements = [],
                read = 0;

            while (true) {
                var tag = Tag.readTag(stream),
                    length = null;
                read += 4;

                if (tag.is(0xfffee0dd)) {
                    stream.readUint32();
                    break;
                } else if (!undefLength && read == sqlength) {
                    break;
                } else if (tag.is(0xfffee000)) {
                    length = stream.readUint32();
                    read += 4;
                    var itemStream = null,
                        toRead = 0,
                        undef = length == 0xffffffff;

                    if (undef) {
                        var stack = 0;

                        /* eslint-disable-next-line no-constant-condition */
                        while (1) {
                            var g = stream.readUint16();
                            if (g == 0xfffe) {
                                // some control tag is about to be read
                                var ge = stream.readUint16();

                                let itemLength = stream.readUint32();
                                stream.increment(-4);

                                if (ge == 0xe00d) {
                                    if (itemLength === 0) {
                                        // item delimitation tag (0xfffee00d) + item length (0x00000000) has been read
                                        stack--;
                                        if (stack < 0) {
                                            // if we are outside every stack, then we are finished reading the sequence of items
                                            stream.increment(4);
                                            read += 8;
                                            break;
                                        } else {
                                            // otherwise, we were in a nested sequence of items
                                            toRead += 4;
                                        }
                                    } else {
                                        // anything else has been read
                                        toRead += 2;
                                    }
                                } else if (ge == 0xe000) {
                                    // a new item has been found
                                    toRead += 4;

                                    if (itemLength == 0xffffffff) {
                                        // a new item with undefined length has been found
                                        stack++;
                                    }
                                } else {
                                    // some control tag that does not concern sequence of items has been read
                                    toRead += 2;
                                    stream.increment(-2);
                                }
                            } else {
                                // anything else has been read
                                toRead += 2;
                            }
                        }
                    } else {
                        toRead = length;
                    }

                    if (toRead) {
                        stream.increment(undef ? -toRead - 8 : 0);
                        itemStream = stream.more(toRead); //parseElements
                        read += toRead;
                        if (undef) stream.increment(8);

                        var items = DicomMessage._read(itemStream, syntax);
                        elements.push(items);
                    }
                    if (!undefLength && read == sqlength) {
                        break;
                    }
                }
            }
            return elements;
        }
    }

    writeBytes(stream, value, syntax, writeOptions) {
        let written = 0;

        if (value) {
            for (var i = 0; i < value.length; i++) {
                var item = value[i];
                super.write(stream, "Uint16", 0xfffe);
                super.write(stream, "Uint16", 0xe000);
                super.write(stream, "Uint32", 0xffffffff);

                written += DicomMessage.write(
                    item,
                    stream,
                    syntax,
                    writeOptions
                );

                super.write(stream, "Uint16", 0xfffe);
                super.write(stream, "Uint16", 0xe00d);
                super.write(stream, "Uint32", 0x00000000);
                written += 16;
            }
        }
        super.write(stream, "Uint16", 0xfffe);
        super.write(stream, "Uint16", 0xe0dd);
        super.write(stream, "Uint32", 0x00000000);
        written += 8;

        return super.writeBytes(stream, value, written, writeOptions);
    }
}

class SignedShort extends ValueRepresentation {
    constructor() {
        super("SS");
        this.maxLength = 2;
        this.valueLength = 2;
        this.fixed = true;
        this.defaultValue = 0;
    }

    readBytes(stream) {
        return stream.readInt16();
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Int16", value),
            writeOptions
        );
    }
}

class ShortText extends EncodedStringRepresentation {
    constructor() {
        super("ST");
        this.maxCharLength = 1024;
    }

    readBytes(stream, length) {
        return super.readPaddedEncodedString(stream, length);
    }

    applyFormatting(value) {
        return rtrim(value);
    }
}

class TimeValue extends AsciiStringRepresentation {
    constructor() {
        super("TM");
        this.maxLength = 16;
        this.rangeMatchingMaxLength = 28;
    }

    readBytes(stream, length) {
        return super.readPaddedAsciiString(stream, length);
    }

    applyFormatting(value) {
        return rtrim(value);
    }

    checkLength(value) {
        if (typeof value === "string" || value instanceof String) {
            const isRangeQuery = value.includes("-");
            return (
                value.length <=
                (isRangeQuery ? this.rangeMatchingMaxLength : this.maxLength)
            );
        }
        return true;
    }
}

class UnlimitedCharacters extends EncodedStringRepresentation {
    constructor() {
        super("UC");
        this.maxLength = null;
        this.multi = true;
    }

    readBytes(stream, length) {
        return super.readPaddedEncodedString(stream, length);
    }

    applyFormatting(value) {
        return rtrim(value);
    }
}

class UnlimitedText extends EncodedStringRepresentation {
    constructor() {
        super("UT");
        this.maxLength = null;
    }

    readBytes(stream, length) {
        return super.readPaddedEncodedString(stream, length);
    }

    applyFormatting(value) {
        return rtrim(value);
    }
}

class UnsignedShort extends ValueRepresentation {
    constructor() {
        super("US");
        this.maxLength = 2;
        this.fixed = true;
        this.defaultValue = 0;
    }

    readBytes(stream) {
        return stream.readUint16();
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Uint16", value),
            writeOptions
        );
    }
}

class UnsignedLong extends ValueRepresentation {
    constructor() {
        super("UL");
        this.maxLength = 4;
        this.fixed = true;
        this.defaultValue = 0;
    }

    readBytes(stream) {
        return stream.readUint32();
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Uint32", value),
            writeOptions
        );
    }
}

class Unsigned64BitVeryLong extends ValueRepresentation {
    constructor() {
        super("UV");
        this.maxLength = 8;
        this.padByte = PADDING_NULL;
        this.fixed = true;
        this.defaultValue = 0;
    }

    readBytes(stream) {
        return stream.readBigUint64();
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "BigUint64", value),
            writeOptions
        );
    }
}

class UniqueIdentifier extends AsciiStringRepresentation {
    constructor() {
        super("UI");
        this.maxLength = 64;
    }

    readBytes(stream, length) {
        const result = this.readPaddedAsciiString(stream, length);

        const BACKSLASH = String.fromCharCode(VM_DELIMITER);

        // Treat backslashes as a delimiter for multiple UIDs, in which case an
        // array of UIDs is returned. This is used by DICOM Q&R to support
        // querying and matching multiple items on a UID field in a single
        // query. For more details see:
        //
        // https://dicom.nema.org/medical/dicom/current/output/chtml/part04/sect_C.2.2.2.2.html
        // https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_6.4.html

        if (result.indexOf(BACKSLASH) === -1) {
            return result;
        } else {
            return this.dropPadByte(result.split(BACKSLASH));
        }
    }

    applyFormatting(value) {
        const removeInvalidUidChars = uidStr => {
            return uidStr.replace(/[^0-9.]/g, "");
        };

        if (Array.isArray(value)) {
            return value.map(removeInvalidUidChars);
        }

        return removeInvalidUidChars(value);
    }
}

class UniversalResource extends AsciiStringRepresentation {
    constructor() {
        super("UR");
        this.maxLength = null;
    }

    readBytes(stream, length) {
        return super.readPaddedAsciiString(stream, length);
    }
}

class UnknownValue extends BinaryRepresentation {
    constructor() {
        super("UN");
        this.maxLength = null;
        this.noMultiple = true;
    }
}

class ParsedUnknownValue extends BinaryRepresentation {
    constructor(vr) {
        super(vr);
        this.maxLength = null;
        this.noMultiple = true;
        this._isBinary = true;
        this._allowMultiple = false;
        this._isLength32 = true;
        this._storeRaw = true;
    }

    read(stream, length, syntax, readOptions) {
        const arrayBuffer = this.readBytes(stream, length, syntax)[0];
        const streamFromBuffer = new ReadBufferStream(arrayBuffer, true);
        const vr = ValueRepresentation.createByTypeString(this.type);

        if (vr.isBinary() && length > vr.maxLength && !vr.noMultiple) {
            var values = [];
            var rawValues = [];
            var times = length / vr.maxLength,
                i = 0;

            while (i++ < times) {
                const { rawValue, value } = vr.read(
                    streamFromBuffer,
                    vr.maxLength,
                    syntax,
                    readOptions
                );
                rawValues.push(rawValue);
                values.push(value);
            }
            return { rawValue: rawValues, value: values };
        } else {
            return vr.read(streamFromBuffer, length, syntax, readOptions);
        }
    }
}

class OtherWordString extends BinaryRepresentation {
    constructor() {
        super("OW");
        this.maxLength = null;
        this.noMultiple = true;
    }
}

class OtherByteString extends BinaryRepresentation {
    constructor() {
        super("OB");
        this.maxLength = null;
        this.noMultiple = true;
    }
}

class OtherDoubleString extends BinaryRepresentation {
    constructor() {
        super("OD");
        this.maxLength = null;
        this.noMultiple = true;
    }
}

class OtherFloatString extends BinaryRepresentation {
    constructor() {
        super("OF");
        this.maxLength = null;
        this.noMultiple = true;
    }
}

// these VR instances are precreate and are reused for each requested vr/tag
let VRinstances = {
    AE: new ApplicationEntity(),
    AS: new AgeString(),
    AT: new AttributeTag(),
    CS: new CodeString(),
    DA: new DateValue(),
    DS: new DecimalString(),
    DT: new DateTime(),
    FL: new FloatingPointSingle(),
    FD: new FloatingPointDouble(),
    IS: new IntegerString(),
    LO: new LongString(),
    LT: new LongText(),
    OB: new OtherByteString(),
    OD: new OtherDoubleString(),
    OF: new OtherFloatString(),
    OW: new OtherWordString(),
    PN: new PersonName(),
    SH: new ShortString(),
    SL: new SignedLong(),
    SQ: new SequenceOfItems(),
    SS: new SignedShort(),
    ST: new ShortText(),
    TM: new TimeValue(),
    UC: new UnlimitedCharacters(),
    UI: new UniqueIdentifier(),
    UL: new UnsignedLong(),
    UN: new UnknownValue(),
    UR: new UniversalResource(),
    US: new UnsignedShort(),
    UT: new UnlimitedText(),
    UV: new Unsigned64BitVeryLong()
};

export { ValueRepresentation };
