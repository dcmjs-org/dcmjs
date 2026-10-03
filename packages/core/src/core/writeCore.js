import { Tag } from "../Tag.js";
import { ValueRepresentation } from "../ValueRepresentation.js";
import { deepEqual } from "../utilities/deepEqual.js";

/**
 * The dataset/element write primitives, relocated verbatim from
 * DicomMessage.write / writeTagObject / _getTagWriteValues (whose statics now
 * delegate here) so the streaming writer and the eager writer share one
 * implementation without the generator package importing @dcmjs-org/legacy.
 *
 * Everything these functions touch is core's: Tag.write drives the element
 * encoding through ValueRepresentation, and deepEqual backs the
 * _rawValue-vs-Value fidelity check. Tag and ValueRepresentation are only
 * dereferenced at call time, per the circular-import discipline of the wider
 * codebase (ValueRepresentation's sequence writer calls back into
 * writeDataSet for its items).
 */

/**
 * Relocated from DicomMessage._getTagWriteValues: write _rawValue back
 * unformatted when the formatted original still equals Value (the value was
 * never touched), otherwise write the edited Value.
 */
export function getTagWriteValues(vrType, tagObject) {
    if (!tagObject._rawValue) {
        return tagObject.Value;
    }

    // apply VR specific formatting to the original _rawValue and compare to the Value
    const vr = ValueRepresentation.createByTypeString(vrType);

    let originalValue;
    if (Array.isArray(tagObject._rawValue)) {
        originalValue = tagObject._rawValue.map(val => vr.applyFormatting(val));
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

/** Relocated from DicomMessage.writeTagObject. */
export function writeTagObject(
    stream,
    tagString,
    vr,
    values,
    syntax,
    writeOptions
) {
    var tag = Tag.fromString(tagString);

    tag.write(stream, vr, values, syntax, writeOptions);
}

/** Relocated from DicomMessage.write: one tag-keyed object, sorted tag order. */
export function writeDataSet(jsonObjects, useStream, syntax, writeOptions) {
    var written = 0;

    var sortedTags = Object.keys(jsonObjects).sort();
    sortedTags.forEach(function (tagString) {
        var tag = Tag.fromString(tagString),
            tagObject = jsonObjects[tagString],
            vrType = tagObject.vr;

        var values = getTagWriteValues(vrType, tagObject);

        written += tag.write(useStream, vrType, values, syntax, writeOptions);
    });

    return written;
}
