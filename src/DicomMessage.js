import { DeflatedReadBufferStream, ReadBufferStream } from "./BufferStream.js";
import {
    DEFLATED_EXPLICIT_LITTLE_ENDIAN,
    EXPLICIT_BIG_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    VM_DELIMITER
} from "./constants/dicom.js";
import { DicomDict } from "./DicomDict.js";
import { DicomMetaDictionary } from "./DicomMetaDictionary.js";
import { Tag } from "./Tag.js";
import { log } from "./log.js";
import { deepEqual } from "./utilities/deepEqual";
import { ValueRepresentation } from "./ValueRepresentation.js";
import { DictCreator } from "./DictCreator.js";

class DicomMessage {
    static read(
        bufferStream,
        syntax,
        ignoreErrors,
        untilTag = null,
        includeUntilTagValue = false
    ) {
        log.warn("DicomMessage.read to be deprecated after dcmjs 0.24.x");
        return this._read(bufferStream, syntax, {
            ignoreErrors: ignoreErrors,
            untilTag: untilTag,
            includeUntilTagValue: includeUntilTagValue
        });
    }

    static readTag(
        bufferStream,
        syntax,
        untilTag = null,
        includeUntilTagValue = false
    ) {
        log.warn("DicomMessage.readTag to be deprecated after dcmjs 0.24.x");
        return this._readTag(bufferStream, syntax, {
            untilTag: untilTag,
            includeUntilTagValue: includeUntilTagValue
        });
    }

    static _read(
        bufferStream,
        syntax,
        options = {
            ignoreErrors: false,
            untilTag: null,
            includeUntilTagValue: false,
            stopOnGreaterTag: false
        }
    ) {
        if (!options.dictCreator) {
            options = {
                ...options,
                dictCreator: new DictCreator(this, options)
            };
        }
        const { ignoreErrors, untilTag, stopOnGreaterTag, dictCreator } =
            options;
        try {
            let previousTagOffset;
            while (!bufferStream.end()) {
                if (dictCreator.continueParse(bufferStream)) {
                    continue;
                }
                previousTagOffset = bufferStream.offset;
                const header = this._readTagHeader(
                    bufferStream,
                    syntax,
                    options
                );
                const handledByCreator =
                    !header.untilTag &&
                    dictCreator.handleTagBody(
                        header,
                        bufferStream,
                        syntax,
                        options
                    );
                if (handledByCreator) {
                    continue;
                }
                const readInfo = header.untilTag
                    ? header
                    : this._readTagBody(header, bufferStream, syntax, options);

                const cleanTagString = readInfo.tag.toCleanString();
                if (untilTag && stopOnGreaterTag && cleanTagString > untilTag) {
                    bufferStream.offset = previousTagOffset;
                    break;
                }
                // TODO - move this into DictCreator as a special handler
                if (cleanTagString === "00080005") {
                    if (readInfo.values.length > 0) {
                        bufferStream.setDecoder(
                            readInfo.values[0],
                            ignoreErrors
                        );
                    }
                    if (readInfo.values.length > 1) {
                        if (ignoreErrors) {
                            log.warn(
                                "Using multiple character sets is not supported, proceeding with just the first character set",
                                readInfo.values
                            );
                        } else {
                            throw Error(
                                `Using multiple character sets is not supported: ${readInfo.values}`
                            );
                        }
                    }
                    readInfo.values = ["ISO_IR 192"]; // change SpecificCharacterSet to UTF-8
                }

                dictCreator.setValue(cleanTagString, readInfo);
                if (untilTag && untilTag === cleanTagString) {
                    break;
                }
            }
            return dictCreator.dict;
        } catch (err) {
            if (ignoreErrors) {
                log.warn("WARN:", err);
                return dictCreator.dict;
            }
            throw err;
        }
    }

    static _normalizeSyntax(syntax) {
        if (
            syntax === IMPLICIT_LITTLE_ENDIAN ||
            syntax === EXPLICIT_LITTLE_ENDIAN ||
            syntax === EXPLICIT_BIG_ENDIAN
        ) {
            return syntax;
        } else {
            return EXPLICIT_LITTLE_ENDIAN;
        }
    }

    static isEncapsulated(syntax) {
        return DicomMetaDictionary.encapsulatedSyntaxes.indexOf(syntax) !== -1;
    }

    /**
     * Reads a DICOM input stream from an array buffer.
     *
     * The options includes the specified options, but also creates
     * a DictCreator from the options.  See DictCreator.constructor
     */
    static readFile(
        buffer,
        options = {
            ignoreErrors: false,
            untilTag: null,
            includeUntilTagValue: false,
            noCopy: false,
            forceStoreRaw: false
        }
    ) {
        var stream = new ReadBufferStream(buffer, null, {
                noCopy: options.noCopy
            }),
            useSyntax = EXPLICIT_LITTLE_ENDIAN;
        stream.reset();
        stream.increment(128);
        if (stream.readAsciiString(4) !== "DICM") {
            throw new Error("Invalid DICOM file, expected header is missing");
        }

        // save position before reading first tag
        var metaStartPos = stream.offset;

        // read the first tag to check if it's the meta length tag
        var el = DicomMessage._readTag(stream, useSyntax);

        var metaHeader = {};
        if (el.tag.toCleanString() !== "00020000") {
            // meta length tag is missing
            if (!options.ignoreErrors) {
                throw new Error(
                    "Invalid DICOM file, meta length tag is malformed or not present."
                );
            }

            // reset stream to the position where we started reading tags
            stream.offset = metaStartPos;

            // read meta header elements sequentially
            metaHeader = DicomMessage._read(stream, useSyntax, {
                untilTag: "00030000",
                stopOnGreaterTag: true,
                ignoreErrors: true
            });
        } else {
            // meta length tag is present
            var metaLength = el.values[0];

            // read header buffer using the specified meta length
            var metaStream = stream.more(metaLength);
            metaHeader = DicomMessage._read(metaStream, useSyntax, options);
        }

        //get the syntax
        var mainSyntax = metaHeader["00020010"].Value[0];

        //in case of deflated dataset, decompress and continue
        if (mainSyntax === DEFLATED_EXPLICIT_LITTLE_ENDIAN) {
            stream = new DeflatedReadBufferStream(stream, {
                noCopy: options.noCopy
            });
        }

        mainSyntax = DicomMessage._normalizeSyntax(mainSyntax);
        var objects = DicomMessage._read(stream, mainSyntax, options);

        var dicomDict = new DicomDict(metaHeader);
        dicomDict.dict = objects;

        return dicomDict;
    }

    static writeTagObject(stream, tagString, vr, values, syntax, writeOptions) {
        var tag = Tag.fromString(tagString);

        tag.write(stream, vr, values, syntax, writeOptions);
    }

    static write(jsonObjects, useStream, syntax, writeOptions) {
        var written = 0;

        var sortedTags = Object.keys(jsonObjects).sort();
        sortedTags.forEach(function (tagString) {
            var tag = Tag.fromString(tagString),
                tagObject = jsonObjects[tagString],
                vrType = tagObject.vr;

            var values = DicomMessage._getTagWriteValues(vrType, tagObject);

            written += tag.write(
                useStream,
                vrType,
                values,
                syntax,
                writeOptions
            );
        });

        return written;
    }

    static _getTagWriteValues(vrType, tagObject) {
        if (!tagObject._rawValue) {
            return tagObject.Value;
        }

        // apply VR specific formatting to the original _rawValue and compare to the Value
        const vr = ValueRepresentation.createByTypeString(vrType);

        let originalValue;
        if (Array.isArray(tagObject._rawValue)) {
            originalValue = tagObject._rawValue.map(val =>
                vr.applyFormatting(val)
            );
        } else {
            originalValue = vr.applyFormatting(tagObject._rawValue);
        }

        // if Value has not changed, write _rawValue unformatted back into the file
        if (deepEqual(tagObject.Value, originalValue)) {
            return tagObject._rawValue;
        } else {
            return tagObject.Value;
        }
    }

    /**
     * Reads the next tag instance and the tag instance body.  This is
     * equivalent to _readTagHeader and _readTagBody.
     */
    static _readTag(
        stream,
        syntax,
        options = {
            untilTag: null,
            includeUntilTagValue: false
        }
    ) {
        const header = this._readTagHeader(stream, syntax, options);
        if (!header || header.values === 0) {
            return header;
        }
        return this._readTagBody(header, stream, syntax, options);
    }

    /**
     * Reads the tag header information, leaving the stream at the start
     * of the data stream.  This allows a dict creator to take control
     * of the stream reading and split the handling off for specific tags
     * such as pixel data tags.
     */
    static _readTagHeader(
        stream,
        syntax,
        options = {
            untilTag: null,
            includeUntilTagValue: false
        }
    ) {
        const { untilTag, includeUntilTagValue } = options;
        var implicit = syntax === IMPLICIT_LITTLE_ENDIAN,
            isLittleEndian =
                syntax === IMPLICIT_LITTLE_ENDIAN ||
                syntax === EXPLICIT_LITTLE_ENDIAN;

        var oldEndian = stream.isLittleEndian;
        stream.setEndian(isLittleEndian);
        var tag = Tag.readTag(stream);

        if (untilTag && untilTag === tag.toCleanString()) {
            if (!includeUntilTagValue) {
                return { tag: tag, vr: 0, values: 0, untilTag: true };
            }
        }

        var length = null,
            vr = null,
            vrType;

        if (tag.isInstruction()) {
            length = stream.readUint32();
            vr = ValueRepresentation.createByTypeString("UN");
        } else if (implicit) {
            length = stream.readUint32();
            var elementData = DicomMessage.lookupTag(tag);
            if (elementData) {
                vrType = elementData.vr;
            } else {
                //unknown tag
                if (length === 0xffffffff) {
                    vrType = "SQ";
                } else if (tag.isPixelDataTag()) {
                    vrType = "OW";
                } else if (vrType === "xs") {
                    vrType = "US";
                } else if (tag.isPrivateCreator()) {
                    vrType = "LO";
                } else {
                    vrType = "UN";
                }
            }
            vr = ValueRepresentation.createByTypeString(vrType);
        } else {
            vrType = stream.readVR();

            if (
                vrType === "UN" &&
                DicomMessage.lookupTag(tag) &&
                DicomMessage.lookupTag(tag).vr
            ) {
                vrType = DicomMessage.lookupTag(tag).vr;

                vr = ValueRepresentation.parseUnknownVr(vrType);
            } else {
                vr = ValueRepresentation.createByTypeString(vrType);
            }

            if (vr.isLength32()) {
                stream.increment(2);
                length = stream.readUint32();
            } else {
                length = stream.readUint16();
            }
        }

        const header = {
            retObj: ValueRepresentation.addTagAccessors({
                tag,
                vr
            }),
            vr,
            tag,
            length,
            oldEndian
        };
        return header;
    }

    /**
     * Default tag body reading.
     */
    static _readTagBody(header, stream, syntax, options) {
        var values = [];
        var rawValues = [];

        // This is an exit by header tag reading.
        if (header.values === 0) {
            return header;
        }
        const { length, vr, retObj, oldEndian } = header;

        if (vr.isBinary() && length > vr.maxLength && !vr.noMultiple) {
            var times = length / vr.maxLength,
                i = 0;
            while (i++ < times) {
                const { rawValue, value } = vr.read(
                    stream,
                    vr.maxLength,
                    syntax,
                    options
                );
                rawValues.push(rawValue);
                values.push(value);
            }
        } else {
            const { rawValue, value } =
                vr.read(stream, length, syntax, options) || {};
            if (
                !vr.isBinary() &&
                ValueRepresentation.singleVRs.indexOf(vr.type) === -1
            ) {
                rawValues = rawValue;
                values = value;
                if (typeof value === "string") {
                    const delimiterChar = String.fromCharCode(VM_DELIMITER);
                    rawValues = vr.dropPadByte(rawValue.split(delimiterChar));
                    values = vr.dropPadByte(value.split(delimiterChar));
                }
            } else if (vr.type === "SQ") {
                rawValues = rawValue;
                values = value;
            } else if (vr.type === "OW" || vr.type === "OB") {
                rawValues = rawValue;
                values = value;
            } else {
                Array.isArray(value) ? (values = value) : values.push(value);
                Array.isArray(rawValue)
                    ? (rawValues = rawValue)
                    : rawValues.push(rawValue);
            }
        }
        stream.setEndian(oldEndian);

        retObj.values = values;
        retObj.rawValues = rawValues;
        return retObj;
    }

    static lookupTag(tag) {
        return DicomMetaDictionary.dictionary[tag.toString()];
    }
}

export { DicomMessage };
