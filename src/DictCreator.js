import { UNDEFINED_LENGTH } from "./constants/dicom.js";
import { ValueRepresentation } from "./ValueRepresentation.js";

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
    handlers = {
        FFFEE000: this.handleItem,
        FFFEE00D: this.handleItemDelimitationEnd,
        FFFEE0DD: this.handleSequenceDelimitationEnd,
        SQ: this.handleSequence
    };

    constructor(dicomMessageProvided) {
        DicomMessage = dicomMessageProvided;
    }

    setValue(cleanTagString, readInfo) {
        const { dict } = this.current;
        dict[cleanTagString] = ValueRepresentation.addTagAccessors({
            vr: readInfo.vr.type
        });
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
        const { vr, tag } = header;
        const cleanTag = tag.toCleanString();

        const handler = this.handlers[cleanTag] || this.handlers[vr.type];

        if (handler) {
            // Item tag - means add to current header and continue parsing
            return handler.call(this, header, stream, tsuid, options);
        }

        // Handle SQ by creating a new tag body that parses to the child element, and has a callback on pop at end

        // Then, add some example handlers for pixel data streams
        // Handle content length pixel data by getting the rows/columns from current.dict and chunking bundles
        // Handle undefined length pixel data by reading chunks and adding.
        // Have options callback for pixel data

        // Then, add example callback for bulkdata write

        // Do all of this in context of this.setValue to assign values.
        return null;
    }

    continueParse(stream) {
        const { current } = this;
        if (
            current.length !== UNDEFINED_LENGTH &&
            current.offset >= 0 &&
            stream.offset >= current.offset + current.length
        ) {
            this.current = this.current.parent;
            if (current.pop) {
                current.pop(current);
            } else {
                this.setValue(current.cleanTagString, current);
            }

            return true;
        }
    }

    /**
     * Handles an ITEM tag value.  This will pop a new handler onto the stack,
     * and create the appropriate sequence item within that stack.
     */
    handleItem(header, stream, tsuid, options) {
        const { length } = header;

        const parent = this.current;
        const dict = {};
        const newCurrent = {
            type: "Item",
            dict,
            parent,
            offset: stream.offset,
            length,
            cleanTagString: parent.dict.length,
            level: parent.level + 1,
            pop: _cur => null
        };
        parent.values.push(dict);
        this.current = newCurrent;
        // Keep on parsing, delivering to the array element
        return true;
    }

    handleItemDelimitationEnd(header, stream, tsuid, options) {
        const { parent } = this.current;
        this.current = parent;
        return true;
    }

    handleSequenceDelimitationEnd(_header, _stream, tsuid, options) {
        const { parent, cleanTagString } = this.current;
        this.setValue(cleanTagString, this.current);
        this.current = parent;
        return true;
    }

    /**
     * Creates a sequence handler
     */
    handleSequence(header, stream, tsuid, _options) {
        const { length } = header;
        const values = [];
        const newCurrent = {
            type: "Sequence",
            dict: this.current.dict,
            values,
            vr: header.vr,
            tag: header.tag,
            parent: this.current,
            offset: stream.offset,
            length,
            level: this.current.level + 1,
            cleanTagString: header.tag.toCleanString()
        };
        this.current = newCurrent;
        // Keep on parsing in the parsing loop - should auto deliver to current.dict
        return true;
    }
}
