import { UNDEFINED_LENGTH } from "./constants/dicom.js";
import { ValueRepresentation } from "./ValueRepresentation.js";

let DicomMessage = null;

/**
 * This class handles assignment of the tag values, and tracks the current
 * parse level.
 * The intent is to allow direct creation/handling of the dict object for
 * various custom purposes such as:
 *
 * * Bulk data direct writes, to avoid needing to keep the entire bulkdata in memory.
 * * Directly normalized instance data
 * * Grouped/deduplicated metadata
 * * Other custom handling.
 * * Direct output stream writing/filtering
 * * Restartable parsing, to allow stream inputs
 */
export class DictCreator {
    dict = {};
    current = { dict: this.dict, parent: null, level: 0 };

    constructor(dicomMessageProvided) {
        DicomMessage = dicomMessageProvided;
    }

    setValue(cleanTagString, readInfo) {
        const { dict } = this.current;
        dict[cleanTagString] = ValueRepresentation.addTagAccessors({
            vr: readInfo.vr.type
        });
        // console.warn("Setting", cleanTagString, readInfo.values);
        dict[cleanTagString].Value = readInfo.values;
        if (readInfo.rawValues !== undefined) {
            dict[cleanTagString]._rawValue = readInfo.rawValues;
        }
    }

    /**
     * Parses the tag body instead of the default handling.  This allows
     * direct streaming from the stream to bulkdata files, as well as
     * allow restarting the overall parse.
     */
    handleTagBody(header, stream, tsuid, options) {
        const { vr, length, tag } = header;
        const cleanTag = tag.toCleanString();
        if (vr.type === "SQ") {
            // console.warn("handle SQ", tag.toString(), length.toString(16), vr.type, tsuid);
            return this.handleSequence(header, stream, tsuid, options);
        } else if (length === -1) {
            // console.warn("Undefined length object", tag.toString(), length, vr, tsuid);
        }

        if (cleanTag === "FFFEE000") {
            // Item tag - means add to current header and continue parsing
            return this.handleItem(header, stream, tsuid, options);
        }

        // console.warn("header=", cleanTag);
        // Handle SQ by creating a new tag body that parses to the child element, and has a callback on pop at end

        // Then, add some example handlers for pixel data streams
        // Handle content length pixel data by getting the rows/columns from current.dict and chunking bundles
        // Handle undefined length pixel data by reading chunks and adding.
        // Have options callback for pixel data

        // Then, add example callback for bulkdata write

        // Do all of this in context of this.setValue to assign values.
        return null;
    }

    /**
     * This will continue a custom parse as required.
     * This allows handling the end of item by popping it off the stack, or
     * delivering data to a listener
     */
    continueParse(stream) {
        const { current } = this;
        if (
            this.current.offset >= 0 &&
            stream.offset >= this.current.offset + this.current.length
        ) {
            // console.warn("Handle pop", current.cleanTagString, current.level);
            this.current = this.current.parent;
            if (current.pop) {
                current.pop(current);
            } else {
                this.setValue(current.cleanTagString, current);
            }

            return true;
        }
    }

    handleItem(header, stream, tsuid, options) {
        const { length } = header;

        if (length === UNDEFINED_LENGTH) {
            // console.warn("No support yet for undefined length");
            return null;
        }

        const parent = this.current;
        const dict = {};
        const newCurrent = {
            dict,
            parent,
            offset: stream.offset,
            length,
            cleanTagString: parent.dict.length,
            level: parent.level + 1,
            pop: _cur => null
        };
        parent.values.push(dict);
        // console.warn("Handle item tag, level, length", newCurrent.cleanTagString, newCurrent.level, length);
        this.current = newCurrent;
        // Keep on parsing, delivering to the array element
        return true;
    }

    /**
     * Creates a sequence handler
     */
    handleSequence(header, stream, tsuid, options) {
        const { length } = header;
        if (length === UNDEFINED_LENGTH) {
            // console.warn("Returning undefined (-1) length sequence", header.tag.toString());
            return;
        }
        const newCurrent = {
            dict: this.current.dict,
            values: [],
            vr: header.vr,
            tag: header.tag,
            parent: this.current,
            offset: stream.offset,
            length,
            level: this.current.level + 1,
            cleanTagString: header.tag.toCleanString()
        };
        // console.warn("Handle sequence tag, level, length", newCurrent.cleanTagString, newCurrent.level, length);
        this.current = newCurrent;
        // Keep on parsing in the parsing loop - should auto deliver to current.dict
        return true;
    }
}
