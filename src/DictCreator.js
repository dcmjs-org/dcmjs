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
    current = { dict: this.dict, parent: null };

    constructor() {}

    setValue(cleanTagString, readInfo) {
        this.dict[cleanTagString] = ValueRepresentation.addTagAccessors({
            vr: readInfo.vr.type
        });
        this.dict[cleanTagString].Value = readInfo.values;
        this.dict[cleanTagString]._rawValue = readInfo.rawValues;
    }

    /**
     * Parses the tag body instead of the default handling.  This allows
     * direct streaming from the stream to bulkdata files, as well as
     * allow restarting the overall parse.
     */
    handleTagBody(_header, _stream, _tsuid, _options) {
        // const { tag, vr, length } = header;
        // console.warn("handleTagBody", tag.toString(), length, vr);
        // Handle SQ by creating a new tag body that parses to the child element, and has a callback on pop at end

        // Then, add some example handlers for pixel data streams
        // Handle content length pixel data by getting the rows/columns from current.dict and chunking bundles
        // Handle undefined length pixel data by reading chunks and adding.
        // Have options callback for pixel data

        // Then, add example callback for bulkdata write

        // Do all of this in context of this.setValue to assign values.
        return null;
    }
}
