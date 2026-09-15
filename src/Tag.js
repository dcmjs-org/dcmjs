import { WriteBufferStream } from "./BufferStream.js";
import {
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    SEQUENCE_DELIMITER_TAG,
    SEQUENCE_ITEM_TAG,
    UNDEFINED_LENGTH
} from "./constants/dicom";
import { ValueRepresentation } from "./ValueRepresentation.js";

function paddingLeft(paddingValue, string) {
    return String(paddingValue + string).slice(-paddingValue.length);
}

// An explicit VR 2-byte length field cannot encode lengths of 0x10000 bytes
// or more; such values switch to the "Big 16" header (VR "UN" + 4-byte
// length field) instead.
const BIG16_LENGTH = 0x10000;

/**
 * Exact encoded value length for fixed-size binary VRs (AT/FL/FD/SL/SS/UL/US):
 * every value writes exactly vr.maxLength bytes, binary VRs never emit VM
 * delimiters, and the fixed sizes are all even so no padding is added.
 */
function fixedBinaryValueLength(vr, values) {
    if (values === null || values === undefined || values === "") {
        return 0;
    }
    if (Array.isArray(values)) {
        return values.length * vr.maxLength;
    }
    return vr.maxLength;
}

/**
 * Cheap, conservative upper bound (in bytes) on the encoded length of a
 * variable-length (string-like) value. Used only to decide whether an
 * explicit VR element with a 2-byte length field could overflow it (the
 * Big 16 case): an over-estimate merely routes the element through the
 * exact measuring path, while an under-estimate would corrupt the header,
 * so every estimate here errs upwards. Returns Infinity when no cheap
 * bound exists.
 */
function valueByteUpperBound(values) {
    if (values === null || values === undefined || values === "") {
        return 0;
    }
    const valueList = Array.isArray(values) ? values : [values];
    // one byte per VM delimiter plus a possible trailing pad byte
    let bound = valueList.length + 1;
    for (let i = 0; i < valueList.length; i++) {
        const value = valueList[i];
        if (value === null || value === undefined) {
            // encodes as an empty or "null"-coerced string
            bound += 16;
        } else if (typeof value === "string" || value instanceof String) {
            // writeUTF8String emits at most 3 bytes per UTF-16 code unit;
            // writeAsciiString emits exactly one
            bound += value.length * 3;
        } else if (typeof value === "number") {
            // numeric-to-string encodings (DS caps at 16 chars, IS at 12,
            // generic String(number) at 24) all stay below this
            bound += 32;
        } else if (typeof value === "bigint") {
            // bigints encode as their full decimal expansion (TextEncoder
            // coerces via ToString, one byte per ASCII digit/sign), which
            // is unbounded - a flat constant would UNDER-estimate a
            // >0xffff-digit value and corrupt the 2-byte length header
            // instead of routing it through the measured Big16 path.
            bound += String(value).length;
        } else if (typeof value === "object") {
            // PN dicom+json objects: string components joined by ^ and =
            for (const key in value) {
                const component = value[key];
                if (
                    typeof component === "string" ||
                    component instanceof String
                ) {
                    bound += component.length * 3 + 1;
                } else if (component !== null && component !== undefined) {
                    return Infinity;
                }
            }
            bound += 4;
        } else {
            return Infinity;
        }
        if (bound >= BIG16_LENGTH) {
            return bound;
        }
    }
    return bound;
}

let DicomMessage;

class Tag {
    constructor(value) {
        this.value = value;
    }

    /** Helper method to avoid circular dependencies */
    static setDicomMessageClass(dicomMessageClass) {
        DicomMessage = dicomMessageClass;
    }

    toString() {
        return (
            "(" +
            paddingLeft("0000", this.group().toString(16).toUpperCase()) +
            "," +
            paddingLeft("0000", this.element().toString(16).toUpperCase()) +
            ")"
        );
    }

    toCleanString() {
        return (
            paddingLeft("0000", this.group().toString(16).toUpperCase()) +
            paddingLeft("0000", this.element().toString(16).toUpperCase())
        );
    }

    get cleanString() {
        this._cleanString ||= this.toCleanString();
        return this._cleanString;
    }

    is(t) {
        return this.value == t;
    }

    /**
     * @returns true if the tag is an Item or Delimiter instruction
     */
    isInstruction() {
        return this.group() === 0xfffe;
    }

    group() {
        return this.value >>> 16;
    }

    element() {
        return this.value & 0xffff;
    }

    isPixelDataTag() {
        return this.is(0x7fe00010);
    }

    isPrivateCreator() {
        // PS3.5 7.8.1: private creator data elements occupy (gggg,0010-00FF)
        // in odd groups; elements (gggg,0001-000F) are reserved and "shall
        // not be used", so they are not creators.
        const group = this.group();
        const element = this.element();
        return group % 2 === 1 && element >= 0x10 && element <= 0xff;
    }

    isMetaInformation() {
        return this.group() < 0x0008;
    }

    isPrivateValue() {
        const group = this.group();
        const element = this.element();
        return group % 2 === 1 && element > 0x100;
    }

    static fromString(str) {
        var group = parseInt(str.substring(0, 4), 16),
            element = parseInt(str.substring(4), 16);
        return Tag.fromNumbers(group, element);
    }

    static fromPString(str) {
        var group = parseInt(str.substring(1, 5), 16),
            element = parseInt(str.substring(6, 10), 16);
        return Tag.fromNumbers(group, element);
    }

    static fromNumbers(group, element) {
        return new Tag(((group << 16) | element) >>> 0);
    }

    static readTag(stream) {
        var group = stream.readUint16(),
            element = stream.readUint16();
        return Tag.fromNumbers(group, element);
    }

    /**
     * Reads the stream looking for the sequence item tags, returning them
     * as a buffer, and returning null on sequence delimiter tag.
     */
    static getNextSequenceItemData(stream) {
        const nextTag = this.readTag(stream);
        if (nextTag.is(SEQUENCE_ITEM_TAG)) {
            const itemLength = stream.readUint32();
            const buffer = stream.getBuffer(
                stream.offset,
                stream.offset + itemLength
            );
            stream.increment(itemLength);
            return buffer;
        } else if (nextTag.is(SEQUENCE_DELIMITER_TAG)) {
            // Read SequenceDelimiterItem value for the SequenceDelimiterTag
            if (stream.readUint32() !== 0) {
                throw Error("SequenceDelimiterItem tag value was not zero");
            }
            return null;
        }

        throw Error("Invalid tag in sequence");
    }

    write(stream, vrType, values, syntax, writeOptions) {
        const vr = ValueRepresentation.createByTypeString(vrType);
        const useSyntax = DicomMessage._normalizeSyntax(syntax);

        const implicit = useSyntax === IMPLICIT_LITTLE_ENDIAN;
        const isLittleEndian =
            useSyntax === IMPLICIT_LITTLE_ENDIAN ||
            useSyntax === EXPLICIT_LITTLE_ENDIAN;
        const isEncapsulated =
            this.isPixelDataTag() && DicomMessage.isEncapsulated(syntax);

        const oldEndian = stream.isLittleEndian;
        stream.setEndian(isLittleEndian);

        stream.writeUint16(this.group());
        stream.writeUint16(this.element());

        let written = 4;

        // Stream offset of the reserved length field, backpatched once the
        // value bytes are in place; -1 when the length was written up front.
        let lengthOffset = -1;
        let length16 = false;

        if (implicit) {
            lengthOffset = stream.offset;
            stream.writeUint32(0);
            written += 4;
        } else if (vr.isLength32()) {
            stream.writeAsciiString(vr.type);
            stream.writeUint16(0);
            lengthOffset = stream.offset;
            stream.writeUint32(0);
            written += 8;
        } else if (vr.isBinary() && vr.fixed && vr.maxLength) {
            // Fixed-size binary VRs encode exactly maxLength bytes per value
            // with no delimiters or padding: the value length (and with it
            // the Big 16 decision) is known before writing, so the header
            // can be emitted up front without backpatching.
            const valueLength = fixedBinaryValueLength(vr, values);
            if (valueLength >= BIG16_LENGTH) {
                // Big 16: a VR=UN substitution with a 32 bit length, for
                // values larger than a 16 bit length field can encode.
                stream.writeAsciiString("UN");
                stream.writeUint16(0);
                stream.writeUint32(valueLength);
                written += 8;
            } else {
                stream.writeAsciiString(vr.type);
                stream.writeUint16(valueLength);
                written += 4;
            }
        } else if (valueByteUpperBound(values) >= BIG16_LENGTH) {
            // Rare: a variable-length value that may overflow the 2-byte
            // length field. The 8-byte header cannot be backpatched into the
            // 12-byte Big 16 (VR=UN) layout after the fact, so measure the
            // exact encoded length through a scratch stream first (the
            // historical write path).
            written += this._writeMeasured(
                stream,
                vr,
                values,
                isLittleEndian,
                writeOptions
            );
            stream.setEndian(oldEndian);
            return written;
        } else {
            stream.writeAsciiString(vr.type);
            lengthOffset = stream.offset;
            stream.writeUint16(0);
            written += 4;
            length16 = true;
        }

        const valueStart = stream.offset;
        let valueLength;
        if (vrType == "OW" || vrType == "OB" || vrType == "UN") {
            // The RAW (un-normalized) syntax is passed here: normalizeSyntax
            // collapses every encapsulated syntax to explicit little endian,
            // but BinaryRepresentation.writeBytes must see the real transfer
            // syntax to enforce one-fragment-per-frame for RLE Lossless
            // (issue #340). Binary VRs use the syntax for nothing else.
            valueLength = vr.writeBytes(
                stream,
                values,
                syntax,
                isEncapsulated,
                writeOptions
            );
        } else if (vrType == "SQ") {
            valueLength = vr.writeBytes(
                stream,
                values,
                useSyntax,
                writeOptions
            );
        } else {
            valueLength = vr.writeBytes(stream, values, writeOptions);
        }

        if (vrType == "SQ") {
            valueLength = UNDEFINED_LENGTH;
        }
        written += stream.offset - valueStart;

        if (lengthOffset !== -1) {
            if (length16) {
                if (valueLength >= BIG16_LENGTH) {
                    // Guarded against by valueByteUpperBound above.
                    throw new Error(
                        `Internal error: value length ${valueLength} overflows ` +
                            `the 16 bit length field of vr ${vr.type}`
                    );
                }
                stream.writeUint16At(lengthOffset, valueLength);
            } else {
                stream.writeUint32At(lengthOffset, valueLength);
            }
        }

        stream.setEndian(oldEndian);

        return written;
    }

    /**
     * Writes an explicit VR element whose value may overflow the 2-byte
     * length field: the value is encoded into a scratch stream to learn its
     * exact length, then the header (Big 16 VR=UN + 32 bit length when it
     * overflows, the plain 2-byte length header otherwise) and the measured
     * bytes are emitted. Returns the bytes written after the tag.
     */
    _writeMeasured(stream, vr, values, isLittleEndian, writeOptions) {
        const tagStream = new WriteBufferStream(256);
        tagStream.setEndian(isLittleEndian);

        // Only non-length32 VRs reach this path, so the OB/OW/UN/SQ
        // writeBytes signatures do not apply.
        const valueLength = vr.writeBytes(tagStream, values, writeOptions);

        let written = tagStream.size;
        const isBig16Length =
            valueLength >= BIG16_LENGTH && valueLength !== UNDEFINED_LENGTH;
        if (isBig16Length) {
            // Write as vr UN for big values
            stream.writeAsciiString("UN");
            stream.writeUint16(0);
            stream.writeUint32(valueLength);
            written += 8;
        } else {
            stream.writeAsciiString(vr.type);
            stream.writeUint16(valueLength);
            written += 4;
        }

        stream.concat(tagStream);

        return written;
    }
}

ValueRepresentation.setTagClass(Tag);

export { Tag };
