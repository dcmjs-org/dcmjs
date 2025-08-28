import { DictCreator } from "./DictCreator";
import { DicomMetaDictionary } from "./DicomMetaDictionary";

/**
 * This parser will create an already normalized dataset, directly
 * from the underlying data.
 *
 * There are a few differences from the standard denormalizer:
 *    * Only vm==1 entries will have the value replaced
 *    * No denormalization of meta information is performed
 *    * Private tags are denormalized to a child entry keyed by:
 *      `${creatorName}:${group}`
 *      whose value is an object with values not containing the creator
 *      offset key, and having the original offset as creatorOffset
 */
export class NormalizedDictCreator extends DictCreator {
    setValue(cleanTagString, readInfo) {
        const { tag } = readInfo;
        if (!tag || tag.isMetaInformation()) {
            return super.setValue(cleanTagString, readInfo);
        }
        const { dict } = this.current;
        const { values, BulkDataURI, BulkDataUUID } = readInfo;

        if (tag.isPrivateCreator()) {
            const key = `${values[0]}:${cleanTagString.substring(0, 4)}`;
            const privateValue = {
                key,
                creatorOffset: cleanTagString.substring(6, 8)
            };
            dict[key] = privateValue;
            // Assign it so it is accessible by assigner
            Object.defineProperty(dict, cleanTagString, {
                value: privateValue
            });
            return;
        }

        if (tag.isPrivateValue()) {
            const valueKey =
                cleanTagString.substring(0, 4) +
                "00" +
                cleanTagString.substring(4, 6);
            const key =
                cleanTagString.substring(0, 4) +
                "00" +
                cleanTagString.substring(6, 8);
            const privateValue = dict[valueKey];
            if (!privateValue) {
                console.warn("Private value with no creator tag:", tag);
                return super.setValue(cleanTagString, readInfo);
            }
            if (BulkDataURI || BulkDataUUID) {
                privateValue[key] = { BulkDataURI, BulkDataUUID };
            } else {
                privateValue[key] = values;
            }
            return;
        }

        const punctuatedTag = DicomMetaDictionary.punctuateTag(cleanTagString);
        const entry = DicomMetaDictionary.dictionary[punctuatedTag];
        if (!entry) {
            return super.setValue(cleanTagString, readInfo);
        }

        const { name, vm } = entry;

        if (values === undefined) {
            return;
        }

        if (BulkDataURI || BulkDataUUID) {
            dict[name] = { BulkDataURI, BulkDataUUID };
        }

        if ((vm === "1" || vm === 1) && values?.length === 1) {
            dict[name] = values[0];
        } else {
            dict[name] = values;
        }
    }

    getSingle(cleanTagString) {
        const superValue = super.getSingle(cleanTagString);
        if (superValue !== undefined) {
            return superValue;
        }
        const punctuatedTag = DicomMetaDictionary.punctuateTag(cleanTagString);
        const entry = DicomMetaDictionary.dictionary[punctuatedTag];
        const { dict } = this.current;
        return dict[entry ? entry.name : cleanTagString];
    }
}
