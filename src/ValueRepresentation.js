import { validationLog, log } from "./log.js";
import { DicomMessage } from "./DicomMessage.js";
import { ReadBufferStream } from "./BufferStream.js";
import { WriteBufferStream } from "./BufferStream.js";
import { Tag } from "./Tag.js";
import {
    PADDING_NULL,
    PADDING_SPACE,
    VM_DELIMITER,
    PN_COMPONENT_DELIMITER
} from "./constants/dicom.js";
import dicomJson from "./utilities/dicomJson.js";
import { DicomMetaDictionary } from "./DicomMetaDictionary.js";

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

var binaryVRs = ["FL", "FD", "SL", "SS", "UL", "US", "AT"],
    explicitVRs = ["OB", "OW", "OF", "SQ", "UC", "UR", "UT", "UN"],
    singleVRs = ["SQ", "OF", "OW", "OB", "UN"];

class ValueRepresentation {
    constructor(type) {
        this.type = type;
        this.multi = false;
        this._isBinary = binaryVRs.indexOf(this.type) != -1;
        this._allowMultiple =
            !this._isBinary && singleVRs.indexOf(this.type) == -1;
        this._isExplicit = explicitVRs.indexOf(this.type) != -1;
    }

    isBinary() {
        return this._isBinary;
    }

    allowMultiple() {
        return this._allowMultiple;
    }

    isExplicit() {
        return this._isExplicit;
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

    read(stream, length, syntax) {
        if (this.fixed && this.maxLength) {
            if (!length) return this.defaultValue;
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
        return this.readBytes(stream, length, syntax);
    }

    readBytes(stream, length) {
        return stream.readAsciiString(length);
    }

    readPaddedAsciiString(stream, length) {
        if (!length) return "";
        if (stream.peekUint8(length - 1) !== this.padByte) {
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
            val.length &&
            val[val.length - 1] !== String.fromCharCode(this.padByte)
        ) {
            return val;
        } else {
            return val.slice(0, -1);
        }
    }

    write(stream, type) {
        var args = Array.from(arguments);
        if (args[2] === null || args[2] === "" || args[2] === undefined) {
            return [stream.writeAsciiString("")];
        } else {
            var written = [],
                valueArgs = args.slice(2),
                func = stream["write" + type];
            if (Array.isArray(valueArgs[0])) {
                if (valueArgs[0].length < 1) {
                    written.push(0);
                } else {
                    var self = this;
                    valueArgs[0].forEach(function (v, k) {
                        if (self.allowMultiple() && k > 0) {
                            stream.writeUint8(VM_DELIMITER);
                        }
                        var singularArgs = [v].concat(valueArgs.slice(1));
                        var byteCount = func.apply(stream, singularArgs);
                        written.push(byteCount);
                    });
                }
            } else {
                written.push(func.apply(stream, valueArgs));
            }
            return written;
        }
    }

    writeBytes(
        stream,
        value,
        lengths,
        writeOptions = { allowInvalidVRLength: false }
    ) {
        const { allowInvalidVRLength } = writeOptions;
        var valid = true,
            valarr = Array.isArray(value) ? value : [value],
            total = 0;

        for (var i = 0; i < valarr.length; i++) {
            var checkValue = valarr[i],
                checklen = lengths[i],
                isString = false,
                displaylen = checklen;
            if (checkValue === null || allowInvalidVRLength) {
                valid = true;
            } else if (this.checkLength) {
                valid = this.checkLength(checkValue);
            } else if (this.maxCharLength) {
                var check = this.maxCharLength; //, checklen = checkValue.length;
                valid = checkValue.length <= check;
                displaylen = checkValue.length;
                isString = true;
            } else if (this.maxLength) {
                valid = checklen <= this.maxLength;
            }

            if (!valid) {
                var errmsg =
                    "Value exceeds max length, vr: " +
                    this.type +
                    ", value: " +
                    checkValue +
                    ", length: " +
                    displaylen;
                if (isString) log.log(errmsg);
                else throw new Error(errmsg);
            }
            total += checklen;
        }
        if (this.allowMultiple()) {
            total += valarr.length ? valarr.length - 1 : 0;
        }

        //check for odd
        var written = total;
        if (total & 1) {
            stream.writeUint8(this.padByte);
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
        return stream.readAsciiString(length);
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
        return stream.readEncodedString(length);
    }

    writeBytes(stream, value, writeOptions) {
        const written = super.write(stream, "UTF8String", value);

        return super.writeBytes(stream, value, written, writeOptions);
    }
}

class BinaryRepresentation extends ValueRepresentation {
    constructor(type) {
        super(type);
    }

    writeBytes(stream, value, syntax, isEncapsulated, writeOptions = {}) {
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
                        binaryStream.writeInt8(this.padByte);
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
            return super.writeBytes(
                stream,
                binaryData,
                [binaryStream.size],
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
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        return stream.readAsciiString(length).trim();
    }
}

class CodeString extends AsciiStringRepresentation {
    constructor() {
        super("CS");
        this.maxLength = 16;
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        return stream.readAsciiString(length).trim();
    }
}

class AgeString extends AsciiStringRepresentation {
    constructor() {
        super("AS");
        this.maxLength = 4;
        this.padByte = PADDING_SPACE;
        this.fixed = true;
        this.defaultValue = "";
    }
}

class AttributeTag extends ValueRepresentation {
    constructor() {
        super("AT");
        this.maxLength = 4;
        this.valueLength = 4;
        this.padByte = PADDING_NULL;
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
        this.maxLength = 18;
        this.padByte = PADDING_SPACE;
        //this.fixed = true;
        this.defaultValue = "";
    }
}

class DecimalString extends AsciiStringRepresentation {
    constructor() {
        super("DS");
        this.maxLength = 16;
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        const BACKSLASH = String.fromCharCode(VM_DELIMITER);
        let ds = stream.readAsciiString(length);
        ds = ds.replace(/[^0-9.\\\-+e]/gi, "");
        if (ds.indexOf(BACKSLASH) !== -1) {
            // handle decimal string with multiplicity
            const dsArray = ds.split(BACKSLASH);
            ds = dsArray.map(ds => (ds === "" ? null : Number(ds)));
        } else {
            ds = [ds === "" ? null : Number(ds)];
        }

        return ds;
    }

    formatValue(value) {
        if (value === null) return "";

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
            ? value.map(ds => this.formatValue(ds))
            : [this.formatValue(value)];
        return super.writeBytes(stream, val, writeOptions);
    }
}

class DateTime extends AsciiStringRepresentation {
    constructor() {
        super("DT");
        this.maxLength = 26;
        this.padByte = PADDING_SPACE;
    }
}

class FloatingPointSingle extends ValueRepresentation {
    constructor() {
        super("FL");
        this.maxLength = 4;
        this.padByte = PADDING_NULL;
        this.fixed = true;
        this.defaultValue = 0.0;
    }

    readBytes(stream) {
        return Number(stream.readFloat());
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
        this.padByte = PADDING_NULL;
        this.fixed = true;
        this.defaultValue = 0.0;
    }

    readBytes(stream) {
        return Number(stream.readDouble());
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

class IntegerString extends AsciiStringRepresentation {
    constructor() {
        super("IS");
        this.maxLength = 12;
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        const BACKSLASH = String.fromCharCode(VM_DELIMITER);
        let is = stream.readAsciiString(length).trim();

        is = is.replace(/[^0-9.\\\-+e]/gi, "");

        if (is.indexOf(BACKSLASH) !== -1) {
            // handle integer string with multiplicity
            const integerStringArray = is.split(BACKSLASH);
            is = integerStringArray.map(is => (is === "" ? null : Number(is)));
        } else {
            is = [is === "" ? null : Number(is)];
        }

        return is;
    }

    formatValue(value) {
        return value === null ? "" : String(value);
    }

    writeBytes(stream, value, writeOptions) {
        const val = Array.isArray(value)
            ? value.map(is => this.formatValue(is))
            : [this.formatValue(value)];
        return super.writeBytes(stream, val, writeOptions);
    }
}

class LongString extends EncodedStringRepresentation {
    constructor() {
        super("LO");
        this.maxCharLength = 64;
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        return stream.readEncodedString(length).trim();
    }
}

class LongText extends EncodedStringRepresentation {
    constructor() {
        super("LT");
        this.maxCharLength = 10240;
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        return rtrim(stream.readEncodedString(length));
    }
}

class PersonName extends EncodedStringRepresentation {
    constructor() {
        super("PN");
        this.maxLength = null;
        this.padByte = PADDING_SPACE;
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
        const result = this.readPaddedEncodedString(stream, length);
        return dicomJson.pnConvertToJsonObject(result);
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
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        return stream.readEncodedString(length).trim();
    }
}

class SignedLong extends ValueRepresentation {
    constructor() {
        super("SL");
        this.maxLength = 4;
        this.padByte = PADDING_NULL;
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
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
    }

    readBytes(stream, sqlength, syntax) {
        if (sqlength == 0x0) {
            return []; //contains no dataset
        } else {
            var undefLength = sqlength == 0xffffffff,
                elements = [],
                read = 0;

            /* eslint-disable-next-line no-constant-condition */
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

        return super.writeBytes(stream, value, [written], writeOptions);
    }
}

class SignedShort extends ValueRepresentation {
    constructor() {
        super("SS");
        this.maxLength = 2;
        this.valueLength = 2;
        this.padByte = PADDING_NULL;
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
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        return rtrim(stream.readEncodedString(length));
    }
}

class TimeValue extends AsciiStringRepresentation {
    constructor() {
        super("TM");
        this.maxLength = 14;
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        return rtrim(stream.readAsciiString(length));
    }
}

class UnlimitedCharacters extends EncodedStringRepresentation {
    constructor() {
        super("UC");
        this.maxLength = null;
        this.multi = true;
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        return rtrim(stream.readEncodedString(length));
    }
}

class UnlimitedText extends EncodedStringRepresentation {
    constructor() {
        super("UT");
        this.maxLength = null;
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        return rtrim(stream.readEncodedString(length));
    }
}

class UnsignedShort extends ValueRepresentation {
    constructor() {
        super("US");
        this.maxLength = 2;
        this.padByte = PADDING_NULL;
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
        this.padByte = PADDING_NULL;
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

class UniqueIdentifier extends AsciiStringRepresentation {
    constructor() {
        super("UI");
        this.maxLength = 64;
        this.padByte = PADDING_NULL;
    }

    readBytes(stream, length) {
        const result = this.readPaddedAsciiString(stream, length);

        const BACKSLASH = String.fromCharCode(VM_DELIMITER);
        const uidRegExp = /[^0-9.]/g;

        // Treat backslashes as a delimiter for multiple UIDs, in which case an
        // array of UIDs is returned. This is used by DICOM Q&R to support
        // querying and matching multiple items on a UID field in a single
        // query. For more details see:
        //
        // https://dicom.nema.org/medical/dicom/current/output/chtml/part04/sect_C.2.2.2.2.html
        // https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_6.4.html

        if (result.indexOf(BACKSLASH) === -1) {
            return result.replace(uidRegExp, "");
        } else {
            return result
                .split(BACKSLASH)
                .map(uid => uid.replace(uidRegExp, ""));
        }
    }
}

class UniversalResource extends AsciiStringRepresentation {
    constructor() {
        super("UR");
        this.maxLength = null;
        this.padByte = PADDING_SPACE;
    }

    readBytes(stream, length) {
        return stream.readAsciiString(length);
    }
}

class UnknownValue extends BinaryRepresentation {
    constructor() {
        super("UN");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
    }
}

class ParsedUnknownValue extends BinaryRepresentation {
    constructor(vr) {
        super(vr);
        this.maxLength = null;
        this.padByte = 0;
        this.noMultiple = true;
        this._isBinary = true;
        this._allowMultiple = false;
        this._isExplicit = true;
    }

    read(stream, length, syntax) {
        const arrayBuffer = this.readBytes(stream, length, syntax)[0];
        const streamFromBuffer = new ReadBufferStream(arrayBuffer, true);
        const vr = ValueRepresentation.createByTypeString(this.type);

        var values = [];
        if (vr.isBinary() && length > vr.maxLength && !vr.noMultiple) {
            var times = length / vr.maxLength,
                i = 0;
            while (i++ < times) {
                values.push(vr.read(streamFromBuffer, vr.maxLength, syntax));
            }
        } else {
            var val = vr.read(streamFromBuffer, length, syntax);
            if (!vr.isBinary() && singleVRs.indexOf(vr.type) == -1) {
                values = val;
                if (typeof val === "string") {
                    values = val.split(String.fromCharCode(VM_DELIMITER));
                }
            } else if (vr.type == "SQ") {
                values = val;
            } else if (vr.type == "OW" || vr.type == "OB") {
                values = val;
            } else {
                Array.isArray(val) ? (values = val) : values.push(val);
            }
        }

        return values;
    }
}

class OtherWordString extends BinaryRepresentation {
    constructor() {
        super("OW");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
    }
}

class OtherByteString extends BinaryRepresentation {
    constructor() {
        super("OB");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
    }
}

class OtherDoubleString extends BinaryRepresentation {
    constructor() {
        super("OD");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
    }
}

class OtherFloatString extends BinaryRepresentation {
    constructor() {
        super("OF");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
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
    UT: new UnlimitedText()
};

export { ValueRepresentation };
