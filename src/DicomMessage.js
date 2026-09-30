import { DeflatedReadBufferStream, ReadBufferStream } from "./BufferStream.js";
import {
    DEFLATED_EXPLICIT_LITTLE_ENDIAN,
    EXPLICIT_BIG_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    VM_DELIMITER,
    TagHex,
    encodingMapping,
    unencapsulatedTransferSyntaxes,
    UNDEFINED_LENGTH,
    VALID_VRS
} from "./constants/dicom.js";
import { DicomDict } from "./DicomDict.js";
import { DicomMetaDictionary } from "./DicomMetaDictionary.js";
import { Tag } from "./Tag.js";
import { log } from "./log.js";
import { deepEqual } from "./utilities/deepEqual";
import { ValueRepresentation } from "./ValueRepresentation.js";

export const singleVRs = ["SQ", "OF", "OW", "OB", "UN", "LT"];

export class DicomMessage {
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
        const { ignoreErrors, untilTag, stopOnGreaterTag } = options;
        var dict = {};
        // Options threaded per element so context read earlier in the dataset
        // (PixelRepresentation, needed for "xs" US-vs-SS resolution) is
        // available to later elements. (0028,0103) precedes every "xs" tag in
        // tag order, so it is resolved before it is needed.
        let readOptions = options;
        try {
            let previousTagOffset;
            while (!bufferStream.end()) {
                previousTagOffset = bufferStream.offset;
                const readInfo = DicomMessage._readTag(
                    bufferStream,
                    syntax,
                    readOptions
                );
                const cleanTagString = readInfo.tag.toCleanString();
                if (untilTag && stopOnGreaterTag && cleanTagString > untilTag) {
                    bufferStream.offset = previousTagOffset;
                    break;
                }
                if (cleanTagString === TagHex.SpecificCharacterSet) {
                    if (readInfo.values.length > 0) {
                        let coding = readInfo.values[0];
                        coding = coding.replace(/[_ ]/g, "-").toLowerCase();
                        if (coding in encodingMapping) {
                            coding = encodingMapping[coding];
                            bufferStream.setDecoder(new TextDecoder(coding));
                        } else if (ignoreErrors) {
                            log.warn(
                                `Unsupported character set: ${coding}, using default character set`
                            );
                        } else {
                            throw Error(`Unsupported character set: ${coding}`);
                        }
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

                dict[cleanTagString] = ValueRepresentation.addTagAccessors({
                    vr: readInfo.vr.type
                });
                dict[cleanTagString].Value = readInfo.values;
                dict[cleanTagString]._rawValue = readInfo.rawValues;

                if (
                    cleanTagString === TagHex.PixelRepresentation &&
                    readInfo.values &&
                    readInfo.values.length > 0
                ) {
                    readOptions = {
                        ...readOptions,
                        pixelRepresentation: readInfo.values[0]
                    };
                }

                if (untilTag && untilTag === cleanTagString) {
                    break;
                }
            }
            return dict;
        } catch (err) {
            if (ignoreErrors) {
                log.warn("WARN:", err);
                return dict;
            }
            throw err;
        }
    }

    static _normalizeSyntax(syntax) {
        if (
            syntax == IMPLICIT_LITTLE_ENDIAN ||
            syntax == EXPLICIT_LITTLE_ENDIAN ||
            syntax == EXPLICIT_BIG_ENDIAN
        ) {
            return syntax;
        } else {
            return EXPLICIT_LITTLE_ENDIAN;
        }
    }

    static isEncapsulated(syntax) {
        return !unencapsulatedTransferSyntaxes[syntax];
    }

    /**
     * Sniffs the transfer syntax of a bare (meta-less) dataset: if bytes
     * 4-5 of the first element header form a valid explicit VR code the
     * dataset is Explicit Little Endian, otherwise Implicit Little Endian.
     */
    static _detectBareSyntax(stream) {
        if (stream.size < stream.offset + 8) {
            return EXPLICIT_LITTLE_ENDIAN;
        }
        const vrStr =
            String.fromCharCode(stream.view.getUint8(stream.offset + 4)) +
            String.fromCharCode(stream.view.getUint8(stream.offset + 5));
        return VALID_VRS.has(vrStr)
            ? EXPLICIT_LITTLE_ENDIAN
            : IMPLICIT_LITTLE_ENDIAN;
    }

    static readFile(
        buffer,
        options = {
            ignoreErrors: false,
            untilTag: null,
            includeUntilTagValue: false,
            noCopy: false,
            forceStoreRaw: false,
            // issue #93 opt-in: accept preamble-less / meta-less inputs
            allowMissingHeader: false
        }
    ) {
        var stream = new ReadBufferStream(buffer, null, {
                noCopy: options.noCopy
            }),
            useSyntax = EXPLICIT_LITTLE_ENDIAN;
        stream.reset();
        if (!options.allowMissingHeader) {
            stream.increment(128);
            if (stream.readAsciiString(4) !== "DICM") {
                throw new Error(
                    "Invalid DICOM file, expected header is missing"
                );
            }
        } else {
            // allowMissingHeader: true (issue #93) is an explicit opt-in
            // that also accepts headerless inputs:
            //   - full Part 10 (preamble + DICM): read as usual;
            //   - preamble-less with FMI (group 0002 first): FMI parsing
            //     starts at byte 0;
            //   - bare dataset (DIMSE-style, no FMI): parsed as a raw
            //     dataset, assumed Explicit Little Endian unless implicit
            //     VR is detected from the first element header.
            let hasPart10Header = false;
            if (stream.size >= 132) {
                stream.increment(128);
                hasPart10Header = stream.readAsciiString(4) === "DICM";
                if (!hasPart10Header) {
                    stream.reset();
                }
            }
            if (!hasPart10Header) {
                const firstGroup =
                    stream.size >= 8 ? stream.view.getUint16(0, true) : -1;
                if (firstGroup !== 0x0002) {
                    // Bare dataset: no meta group to read at all.
                    const bareSyntax = DicomMessage._detectBareSyntax(stream);
                    const bareDict = new DicomDict({});
                    bareDict.dict = DicomMessage._read(
                        stream,
                        bareSyntax,
                        options
                    );
                    return bareDict;
                }
                // Preamble-less with FMI: fall through, meta parse at 0.
            }
        }

        // save position before reading first tag
        var metaStartPos = stream.offset;

        // read the first tag to check if it's the meta length tag
        var el = DicomMessage._readTag(stream, useSyntax);

        var metaHeader = {};
        if (el.tag.cleanString !== TagHex.FileMetaInformationGroupLength) {
            // meta length tag is missing. allowMissingHeader (issue #93) is
            // an explicit opt-in to headerless leniency, which includes FMI
            // groups that start directly at (0002,0010) without a
            // (0002,0000) group length.
            if (!options.ignoreErrors && !options.allowMissingHeader) {
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
            // meta length tag is present; save the position right after it
            var metaBodyPos = stream.offset;
            var metaLength = el.values[0];

            // read header buffer using the specified meta length
            var metaStream = stream.more(metaLength);
            metaHeader = DicomMessage._read(metaStream, useSyntax, options);

            // An overstated (0002,0000) pulls dataset elements into the
            // meta header and mis-frames where the body starts. If the
            // declared window contains anything outside group 0002,
            // discard it, warn, and re-walk the meta group structurally
            // so the body is framed at the first non-meta element.
            // An understated (0002,0000) is left alone here: the declared
            // window then holds group-0002 elements only, and is used as-is.
            if (Object.keys(metaHeader).some(tag => !tag.startsWith("0002"))) {
                log.warn(
                    "Invalid DICOM file, meta group length (0002,0000) extends past the end of the File Meta group. Re-reading the meta header structurally."
                );

                // reset stream to the position after the meta length tag
                stream.offset = metaBodyPos;

                // read meta header elements sequentially
                metaHeader = DicomMessage._read(stream, useSyntax, {
                    untilTag: "00030000",
                    stopOnGreaterTag: true,
                    ignoreErrors: true
                });
            }
        }

        //get the syntax
        var mainSyntax = metaHeader[TagHex.TransferSyntaxUID].Value[0];

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
     * Resolves the dictionary meta-VR "xs" ("US or SS") via
     * PixelRepresentation (0028,0103), per PS3.5: SS when the value is 1,
     * US otherwise (including when it is absent). Every read path — sync
     * and async — must use this one resolution.
     */
    static resolveXsVrType(pixelRepresentation) {
        return pixelRepresentation === 1 ? "SS" : "US";
    }

    static _readTag(
        stream,
        syntax,
        options = {
            untilTag: null,
            includeUntilTagValue: false
        }
    ) {
        const { untilTag, includeUntilTagValue } = options;
        var implicit = syntax == IMPLICIT_LITTLE_ENDIAN ? true : false,
            isLittleEndian =
                syntax == IMPLICIT_LITTLE_ENDIAN ||
                syntax == EXPLICIT_LITTLE_ENDIAN
                    ? true
                    : false;

        var oldEndian = stream.isLittleEndian;
        stream.setEndian(isLittleEndian);
        var tag = Tag.readTag(stream);

        if (untilTag === tag.toCleanString() && untilTag !== null) {
            if (!includeUntilTagValue) {
                return { tag: tag, vr: 0, values: 0 };
            }
        }

        var length = null,
            vr = null,
            vrType;

        if (implicit) {
            length = stream.readUint32();
            var elementData = DicomMessage.lookupTag(tag);
            if (elementData) {
                vrType = elementData.vr;
                if (vrType === "xs") {
                    // The dictionary meta-VR "xs" ("US or SS") resolves via
                    // PixelRepresentation (PS3.5). _read threads the parsed
                    // value through options.pixelRepresentation;
                    // (0028,0103) precedes every xs tag in tag order.
                    vrType = DicomMessage.resolveXsVrType(
                        options.pixelRepresentation
                    );
                }
            } else {
                //unknown tag
                if (length == UNDEFINED_LENGTH) {
                    vrType = "SQ";
                } else if (tag.isPixelDataTag()) {
                    vrType = "OW";
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
                if (vrType === "xs") {
                    // Same PixelRepresentation-driven US/SS resolution for
                    // explicit-VR UN elements whose dictionary VR is "xs".
                    vrType = DicomMessage.resolveXsVrType(
                        options.pixelRepresentation
                    );
                }

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

        var values = [];
        var rawValues = [];
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
            if (!vr.isBinary() && singleVRs.indexOf(vr.type) == -1) {
                rawValues = rawValue;
                values = value;
                if (typeof value === "string") {
                    const delimiterChar = String.fromCharCode(VM_DELIMITER);
                    rawValues = vr.dropPadByte(rawValue.split(delimiterChar));
                    values = vr.dropPadByte(value.split(delimiterChar));
                }
            } else if (vr.type == "SQ") {
                rawValues = rawValue;
                values = value;
            } else if (vr.type == "OW" || vr.type == "OB") {
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

        const retObj = ValueRepresentation.addTagAccessors({
            tag: tag,
            vr: vr
        });
        retObj.values = values;
        retObj.rawValues = rawValues;
        return retObj;
    }

    static lookupTag(tag) {
        return DicomMetaDictionary.dictionary[tag.toString()];
    }
}
