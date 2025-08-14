import { WriteBufferStream } from "./BufferStream.js";
import {
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    SEQUENCE_DELIMITER_TAG,
    SEQUENCE_ITEM_TAG
} from "./constants/dicom";
import { ValueRepresentation } from "./ValueRepresentation.js";

function paddingLeft(paddingValue, string) {
    return String(paddingValue + string).slice(-paddingValue.length);
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
        const group = this.group();
        const element = this.element();
        return group % 2 === 1 && element < 0x100 && element > 0x00;
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

        const implicit = useSyntax == IMPLICIT_LITTLE_ENDIAN ? true : false;
        const isLittleEndian =
            useSyntax == IMPLICIT_LITTLE_ENDIAN ||
            useSyntax == EXPLICIT_LITTLE_ENDIAN
                ? true
                : false;
        const isEncapsulated =
            this.isPixelDataTag() && DicomMessage.isEncapsulated(syntax);

        const oldEndian = stream.isLittleEndian;
        stream.setEndian(isLittleEndian);

        stream.writeUint16(this.group());
        stream.writeUint16(this.element());

        var tagStream = new WriteBufferStream(256),
            valueLength;
        tagStream.setEndian(isLittleEndian);

        if (vrType == "OW" || vrType == "OB" || vrType == "UN") {
            valueLength = vr.writeBytes(
                tagStream,
                values,
                useSyntax,
                isEncapsulated,
                writeOptions
            );
        } else if (vrType == "SQ") {
            valueLength = vr.writeBytes(
                tagStream,
                values,
                useSyntax,
                writeOptions
            );
        } else {
            valueLength = vr.writeBytes(tagStream, values, writeOptions);
        }

        if (vrType == "SQ") {
            valueLength = 0xffffffff;
        }
        var written = tagStream.size + 4;

        if (implicit) {
            stream.writeUint32(valueLength);
            written += 4;
        } else {
            // Big 16 length objects are encodings for values larger than
            // 16 bit lengths which would normally use a 16 bit length field.
            // This uses a VR=UN instead of the original VR, and a 32 bit length
            const isBig16Length =
                !vr.isLength32() &&
                valueLength >= 0x10000 &&
                valueLength !== 0xffffffff;
            if (vr.isLength32() || isBig16Length) {
                // Write as vr UN for big values
                stream.writeAsciiString(isBig16Length ? "UN" : vr.type);
                stream.writeUint16(0);
                stream.writeUint32(valueLength);
                written += 8;
            } else {
                stream.writeAsciiString(vr.type);
                stream.writeUint16(valueLength);
                written += 4;
            }
        }

        stream.concat(tagStream);

        stream.setEndian(oldEndian);

        return written;
    }
}

export { Tag };
