import { DeflatedReadBufferStream, ReadBufferStream } from "./BufferStream.js";
import {
    DEFLATED_EXPLICIT_LITTLE_ENDIAN,
    EXPLICIT_BIG_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    VM_DELIMITER,
    TagHex,
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
import { readFileLazy, isCleanForPassthrough } from "./lazy/LazyDicomReader.js";
import { normalizeSyntax } from "./core/normalizeSyntax.js";
import { resolveCharsetDecoder } from "./charset/iso2022.js";

export const singleVRs = ["SQ", "OF", "OW", "OB", "UN", "LT"];

// One-time deprecation notice for the lazy core (2026-08-02 stakeholder
// decision: the event stream delivers the strategic benefit; the lazy core
// and its byte-identity passthrough are deprecated for removal next release).
let lazyCoreDeprecationWarned = false;

export class DicomMessage {
    /**
     * Default read core for readFile: 'eager' (the proven in-place reader,
     * the engine of record) or 'lazy' (offsets-only tokenizer + on-access
     * materialization — DEPRECATED, scheduled for removal in the next
     * release along with the byte-identity passthrough write path).
     * Overridable per call via options.core and globally via the DCMJS_CORE
     * environment variable (DCMJS_CORE=lazy restores the deprecated core).
     */
    static defaultCore =
        (typeof process !== "undefined" &&
            process.env &&
            process.env.DCMJS_CORE) ||
        "eager";

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
                    // Shared charset resolution (single charsets, ISO 2022
                    // code extensions, error policy) — src/charset/iso2022.js
                    const decoder = resolveCharsetDecoder(readInfo.values, {
                        ignoreErrors
                    });
                    if (decoder) {
                        bufferStream.setDecoder(decoder);
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

    /**
     * Detects the transfer syntax of a bare (meta-less) dataset for the
     * readFile allowMissingHeader opt-in (issue #93): Explicit Little
     * Endian is assumed unless the first element header's would-be VR
     * bytes are not a valid VR code, which indicates Implicit VR Little
     * Endian (the bytes are part of a 32-bit length there).
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

    /**
     * Walks the explicit-little-endian File Meta Information elements
     * starting at `metaStart` (the first byte after the (0002,0000) value)
     * and returns the byte length up to the first non-0002 group tag — the
     * structural meta group length. Used to validate/correct a wrong
     * declared (0002,0000) value (issue #338). Stops at any malformed
     * header (undefined length, overrun) so the caller falls back to
     * whatever was walked successfully.
     */
    static _scanMetaGroupLength(stream, metaStart) {
        let offset = metaStart;
        const limit = stream.size;
        while (offset + 8 <= limit) {
            if (stream.view.getUint16(offset, true) !== 0x0002) {
                break;
            }
            const vrStr =
                String.fromCharCode(stream.view.getUint8(offset + 4)) +
                String.fromCharCode(stream.view.getUint8(offset + 5));
            const vr = ValueRepresentation.createByTypeString(vrStr);
            let valueLength;
            let headerLength;
            if (vr.isLength32()) {
                if (offset + 12 > limit) {
                    break;
                }
                valueLength = stream.view.getUint32(offset + 8, true);
                headerLength = 12;
            } else {
                valueLength = stream.view.getUint16(offset + 6, true);
                headerLength = 8;
            }
            if (
                valueLength === UNDEFINED_LENGTH ||
                offset + headerLength + valueLength > limit
            ) {
                break;
            }
            offset += headerLength + valueLength;
        }
        return offset - metaStart;
    }

    static _normalizeSyntax(syntax) {
        // Delegates to the zero-dependency core utility (AD-5) so streaming
        // code can normalize syntaxes without importing the legacy reader.
        return normalizeSyntax(syntax);
    }

    static isEncapsulated(syntax) {
        return !unencapsulatedTransferSyntaxes[syntax];
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
        const core = (options && options.core) || DicomMessage.defaultCore;
        if (core === "lazy") {
            if (!lazyCoreDeprecationWarned) {
                lazyCoreDeprecationWarned = true;
                log.warn(
                    "The 'lazy' read core (and its byte-identity passthrough " +
                        "write path) is deprecated and will be removed in the " +
                        "next release; the event-stream API is the go-forward " +
                        "surface. Remove core:'lazy' / DCMJS_CORE=lazy to use " +
                        "the default eager core."
                );
            }
            return readFileLazy(buffer, options);
        }
        if (core !== "eager") {
            throw new Error(
                `Unknown DicomMessage.readFile core: ${core} (expected 'eager' or 'lazy')`
            );
        }
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
            // Fixed in this arc (issue #93): allowMissingHeader: true is an
            // explicit opt-in that also accepts headerless inputs:
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
            const metaStart = stream.offset;

            // Fixed in this arc: the declared (0002,0000) value is no longer
            // trusted blindly — real clinical files carry wrong group
            // lengths (issue #338). The declared window is tried first
            // (strict parse, so a wrong length cannot yield a silent partial
            // meta); when it does not parse to a meta header containing
            // TransferSyntaxUID, the meta elements are re-walked to the
            // first non-0002 group tag (the streaming path's technique) and
            // that structural length is used instead.
            let metaParsed = false;
            try {
                const metaStream = stream.more(metaLength);
                const candidate = DicomMessage._read(metaStream, useSyntax, {
                    ...options,
                    ignoreErrors: false
                });
                const ts = candidate[TagHex.TransferSyntaxUID];
                if (ts && ts.Value && ts.Value.length) {
                    metaHeader = candidate;
                    metaParsed = true;
                }
            } catch {
                // Fall through to the structural recovery below.
            }
            if (!metaParsed) {
                stream.offset = metaStart;
                const actualMetaLength = DicomMessage._scanMetaGroupLength(
                    stream,
                    metaStart
                );
                log.warn(
                    `(0002,0000) FileMetaInformationGroupLength ${metaLength} does ` +
                        `not parse as the meta group; using the actual meta ` +
                        `group length ${actualMetaLength} instead`
                );
                const metaStream = stream.more(actualMetaLength);
                metaHeader = DicomMessage._read(metaStream, useSyntax, options);
            }
        }

        //get the syntax
        const tsElement = metaHeader[TagHex.TransferSyntaxUID];
        if (!tsElement || !tsElement.Value || !tsElement.Value.length) {
            throw new Error(
                "Invalid DICOM file, meta header is missing TransferSyntaxUID " +
                    "(check the (0002,0000) FileMetaInformationGroupLength value)"
            );
        }
        var mainSyntax = tsElement.Value[0];

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

    /**
     * Writes the elements of jsonObjects to useStream in sorted tag order.
     *
     * `lazyWriteContext` (R4 passthrough fast path) is the dict-level
     * `_lazyWriteContext` a lazy read attaches: when the target BODY
     * syntax equals the source's BODY syntax (the deflated transfer
     * syntax differs from explicit little endian only in the stream-level
     * deflate wrapper - element bytes are ELE on both sides, and a
     * deflated source's spans already index the INFLATED body buffer) and
     * the source charset is byte-stable under the writer's UTF-8
     * normalization, every clean lazy
     * entry (isCleanForPassthrough) is emitted as its verbatim source span
     * - header, value, items and delimiters byte-identical - instead of
     * being re-encoded. Dirty, foreign and span-less entries take the
     * re-encode path unchanged. Callers that pass no context (the meta
     * group, nested sequence items, non-lazy dicts) always re-encode.
     */
    static write(
        jsonObjects,
        useStream,
        syntax,
        writeOptions,
        lazyWriteContext = null
    ) {
        var written = 0;

        // W4: compare BODY syntaxes - the deflated syntax is the ELE body
        // in a deflate wrapper, and DicomDict.write hands this function
        // the pre-deflate body stream, so passthrough applies in every
        // deflated/ELE source-target combination.
        const toBodySyntax = candidate =>
            candidate === DEFLATED_EXPLICIT_LITTLE_ENDIAN
                ? EXPLICIT_LITTLE_ENDIAN
                : candidate;
        // Writer hardening: an encoding-affecting writeOption set to a
        // NON-DEFAULT value asks for bytes the source file does not
        // contain, so emitting source spans would silently ignore it.
        // Passthrough is disabled for the WHOLE dict in that case - simpler
        // and safer than tracking which elements the option touches, and
        // these options are rare. Today the only such option is
        // fragmentMultiframe (default true via
        // `{ fragmentMultiframe = true } = writeOptions` in
        // BinaryRepresentation.writeBytes; it re-fragments encapsulated
        // pixel data). allowInvalidVRLength (default false) is deliberately
        // NOT in this set: it gates write-time validation only, and
        // byte-faithful passthrough legitimately preserves invalid stored
        // lengths (pinned in test/data.test.js).
        const nonDefaultEncodingOptions =
            writeOptions != null &&
            writeOptions.fragmentMultiframe !== undefined &&
            !writeOptions.fragmentMultiframe;
        const passthroughSource =
            !nonDefaultEncodingOptions &&
            lazyWriteContext &&
            lazyWriteContext.charsetPassthroughSafe &&
            toBodySyntax(syntax) === toBodySyntax(lazyWriteContext.sourceSyntax)
                ? lazyWriteContext.sourceByteArray
                : null;

        var sortedTags = Object.keys(jsonObjects).sort();
        sortedTags.forEach(function (tagString) {
            var tagObject = jsonObjects[tagString],
                vrType = tagObject.vr;

            if (passthroughSource && isCleanForPassthrough(tagObject)) {
                const span = tagObject._sourceSpan;
                // The span must index the buffer the context describes:
                // an entry transplanted from another lazy dict carries
                // bytes this context's syntax/charset checks know nothing
                // about, so it re-encodes.
                if (span.buffer === passthroughSource) {
                    written += useStream.writeRawBytes(
                        span.buffer.subarray(span.startOffset, span.endOffset)
                    );
                    return;
                }
            }

            var tag = Tag.fromString(tagString);

            var values = DicomMessage._getTagWriteValues(vrType, tagObject);

            try {
                written += tag.write(
                    useStream,
                    vrType,
                    values,
                    syntax,
                    writeOptions
                );
            } catch (error) {
                // Annotate low-level write failures (e.g. "Not a number:
                // undefined" from the buffer layer, issue #417) with the
                // element being written so the offending tag is actionable.
                const annotated = new Error(
                    `Failed to write tag ${tagString} with VR ${vrType}: ${error.message}`
                );
                annotated.cause = error;
                throw annotated;
            }
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
                    // Fixed in this arc: the dictionary meta-VR "xs" ("US or
                    // SS") now resolves via PixelRepresentation (PS3.5): SS
                    // when (0028,0103) is 1, US otherwise (including when it
                    // is absent). _read threads the parsed value through
                    // options.pixelRepresentation; (0028,0103) precedes every
                    // xs tag in tag order.
                    vrType = options.pixelRepresentation === 1 ? "SS" : "US";
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
                    vrType = options.pixelRepresentation === 1 ? "SS" : "US";
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

        // PS3.5 §6.2.2 (issue #363): a UN element with UNDEFINED length is
        // an Implicit VR Little Endian sequence — its item contents are
        // implicit-VR encoded even inside an explicit-VR dataset (the
        // Philips private-sequence shape). Read it as SQ with the implicit
        // syntax; the element surfaces as a parsed sequence.
        var readSyntax = syntax;
        if (vr.type === "UN" && length === UNDEFINED_LENGTH) {
            vr = ValueRepresentation.createByTypeString("SQ");
            readSyntax = IMPLICIT_LITTLE_ENDIAN;
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
                    readSyntax,
                    options
                );
                rawValues.push(rawValue);
                values.push(value);
            }
        } else {
            const { rawValue, value } =
                vr.read(stream, length, readSyntax, options) || {};
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
