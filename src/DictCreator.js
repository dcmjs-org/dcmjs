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
        SQ: this.handleSequence,
        "7FE00010": this.handlePixel
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
        const parent = this.current;

        if (parent.handleItem) {
            // Call the parent handle item
            return parent.handleItem.call(this, header, stream, tsuid, options);
        }

        const { length } = header;
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
        if (parent.rawValues) {
            parent.rawValues.push(dict);
        }
        this.current = newCurrent;
        // Keep on parsing, delivering to the array element
        return true;
    }

    /**
     * Handles an item delimitation item by switching back to the parent
     * sequence being created.
     */
    handleItemDelimitationEnd(header, stream, tsuid, options) {
        const { parent } = this.current;
        this.current = parent;
        return true;
    }

    /**
     * Handles a sequence delimitation item by setting the value of the parent
     * tag to the sequence result.
     */
    handleSequenceDelimitationEnd(_header, _stream, tsuid, options) {
        const { parent, cleanTagString } = this.current;
        this.setValue(cleanTagString, this.current);
        this.current = parent;
        return true;
    }

    /**
     * Creates a sequence handler
     */
    handleSequence(header, stream, tsuid, options) {
        const { length } = header;
        const values = [];
        const newCurrent = {
            type: "Sequence",
            dict: this.current.dict,
            values,
            rawValues: options.forceStoreRaw ? [] : undefined,
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

    /**
     * Handles pixel data with undefined length
     */
    handlePixelUndefined(header, stream, tsuid, options) {
        const values = [];
        const rawValues = options.forceStoreRaw ? [] : undefined;
        const newCurrent = {
            type: "PixelUndefined",
            dict: this.current.dict,
            values,
            rawValues,
            vr: header.vr,
            tag: header.tag,
            parent: this.current,
            offset: stream.offset,
            level: this.current.level + 1,
            cleanTagString: header.tag.toCleanString(),
            handleItem: this.handlePixelItem
        };
        this.current = newCurrent;
        // Keep on parsing in the parsing loop - this should go into the
        // continue parsing section
        return true;
    }

    /**
     * Reads a "next" pixel data item.
     */
    handlePixelItem(header, stream, tsuid, options) {
        const { current } = this;
        const { length } = header;

        const bytes = stream.getBuffer(stream.offset, stream.offset + length);

        if (!current.offsets) {
            current.offsets = [];
            if (length) {
                const { offsets } = current;
                // Read length entries
                for (let offset = 0; offset < length; offset += 4) {
                    offsets.push(stream.readUint32());
                }
                current.offsetStart = stream.offset;
                current.nextFrameIndex = 1;
            }
            return true;
        }

        stream.increment(length);
        current.values.push(bytes);
        if (current.offsets?.length) {
            const { nextFrameIndex } = current;
            const nextOffset =
                current.offsets[nextFrameIndex] ?? Number.MAX_VALUE;
            const pixelOffset = stream.offset - current.offsetStart;
            if (
                pixelOffset <= nextOffset &&
                current.values.length > nextFrameIndex
            ) {
                if (!Array.isArray(current.values[nextFrameIndex - 1])) {
                    current.values[nextFrameIndex - 1] = [
                        current.values[nextFrameIndex - 1]
                    ];
                }
                current.values[nextFrameIndex - 1].push(current.values.pop());
            }
            if (pixelOffset >= nextOffset) {
                current.nextFrameIndex++;
            }
        }
        return true;
    }

    /**
     * Handles pixel data with defined length
     */
    handlePixelDefined(header, stream, _tsuid, options) {
        const { length } = header;
        const bytes = stream.getBuffer(stream.offset, stream.offset + length);
        stream.increment(length);
        // TODO - split this up into frames
        const values = [bytes];
        const readInfo = {
            ...header,
            values
        };
        if (options.forceStoreRaw) {
            readInfo.rawValues = values;
        }
        this.setValue(header.tag.toCleanString(), readInfo);
        return true;
    }

    /**
     * Handles general pixel data, switching between the two types
     */
    handlePixel(header, stream, tsuid, options) {
        if (this.current.level) {
            throw new Error("Level greater than 0 = " + this.current.level);
        }
        const { length } = header;
        if (length === UNDEFINED_LENGTH) {
            return this.handlePixelUndefined(header, stream, tsuid, options);
        }
        return this.handlePixelDefined(header, stream, tsuid, options);
    }
}
