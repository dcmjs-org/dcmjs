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
}
