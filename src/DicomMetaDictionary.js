import { dictionary } from "./dictionary.fast.js";
import { getAllStandardTagEntries } from "./dicom.lookup.js";
import log from "./log.js";
import addAccessors from "./utilities/addAccessors";
import { ValueRepresentation } from "./ValueRepresentation";
import { encapsulatedSyntaxes } from "./constants/syntaxes";
import { defaultEncoding, encodingMapping } from "./constants/encodings";
import { sopClassNamesByUID } from "./constants/sopClassUIDs";

export class DicomMetaDictionary {
    // intakes a custom dictionary that will be used to parse/denaturalize the dataset
    constructor(customDictionary) {
        this.customDictionary = customDictionary;
        this.customNameMap =
            DicomMetaDictionary._generateCustomNameMap(customDictionary);
    }

    static punctuateTag(rawTag) {
        if (rawTag.indexOf(",") !== -1) {
            return rawTag;
        }
        if (rawTag.length === 8 && rawTag === rawTag.match(/[0-9a-fA-F]*/)[0]) {
            const tag = rawTag.toUpperCase();
            return "(" + tag.substring(0, 4) + "," + tag.substring(4, 8) + ")";
        }
    }

    static unpunctuateTag(tag) {
        if (tag.indexOf(",") === -1) {
            return tag;
        }
        return tag.substring(1, 10).replace(",", "");
    }

    static parseIntFromTag(tag) {
        const integerValue = parseInt(
            "0x" + DicomMetaDictionary.unpunctuateTag(tag)
        );
        return integerValue;
    }

    static tagAsIntegerFromName(name) {
        const item = DicomMetaDictionary.nameMap[name];
        if (item !== undefined) {
            return this.parseIntFromTag(item.tag);
        } else {
            return undefined;
        }
    }

    // fixes some common errors in VRs
    // TODO: if this gets longer it could go in ValueRepresentation.js
    // or in a dedicated class
    static cleanDataset(dataset) {
        const cleanedDataset = {};
        Object.keys(dataset).forEach(tag => {
            const data = Object.assign({}, dataset[tag]);
            if (data.vr === "SQ") {
                const cleanedValues = [];
                Object.keys(data.Value).forEach(index => {
                    cleanedValues.push(
                        DicomMetaDictionary.cleanDataset(data.Value[index])
                    );
                });
                data.Value = cleanedValues;
            } else {
                // remove null characters from strings
                data.Value = Object.keys(data.Value).map(index => {
                    const item = data.Value[index];
                    if (item.constructor.name === "String") {
                        return item.replace(/\0/, "");
                    }
                    return item;
                });
            }
            cleanedDataset[tag] = data;
        });
        return cleanedDataset;
    }

    // unlike naturalizeDataset, this only
    // changes the names of the member variables
    // but leaves the values intact
    static namifyDataset(dataset) {
        var namedDataset = {};
        Object.keys(dataset).forEach(tag => {
            const data = Object.assign({}, dataset[tag]);
            if (data.vr === "SQ") {
                var namedValues = [];
                Object.keys(data.Value).forEach(index => {
                    namedValues.push(
                        DicomMetaDictionary.namifyDataset(data.Value[index])
                    );
                });
                data.Value = namedValues;
            }
            var punctuatedTag = DicomMetaDictionary.punctuateTag(tag);
            var entry = DicomMetaDictionary.dictionary[punctuatedTag];
            var name = tag;
            if (entry) {
                name = entry.name;
            }
            namedDataset[name] = data;
        });
        return namedDataset;
    }

    /**
     * converts from DICOM JSON Model dataset to a natural dataset
     * - sequences become lists
     * - single element lists are replaced by their first element,
     *     with single element lists remaining lists, but being a
     *     proxy for the child values, see addAccessors for examples
     * - object member names are dictionary, not group/element tag
     */
    static naturalizeDataset(dataset) {
        const naturalDataset = ValueRepresentation.addTagAccessors({
            _vrMap: {}
        });

        Object.keys(dataset).forEach(tag => {
            const data = dataset[tag];
            const punctuatedTag = DicomMetaDictionary.punctuateTag(tag);
            const entry = DicomMetaDictionary.dictionary[punctuatedTag];
            let naturalName = tag;

            if (entry) {
                naturalName = entry.name;

                if (entry.vr === "ox") {
                    // when the vr is data-dependent, keep track of the original type
                    naturalDataset._vrMap[naturalName] = data.vr;
                }
                if (data.vr !== entry.vr) {
                    // save origin vr if it different that in dictionary
                    naturalDataset._vrMap[naturalName] = data.vr;
                }
            }

            if (data.Value === undefined) {
                // In the case of type 2, add this tag but explictly set it null to indicate its empty.
                naturalDataset[naturalName] = null;

                if (data.InlineBinary) {
                    naturalDataset[naturalName] = {
                        InlineBinary: data.InlineBinary
                    };
                } else if (data.BulkDataURI) {
                    naturalDataset[naturalName] = {
                        BulkDataURI: data.BulkDataURI
                    };
                }
            } else {
                if (data.vr === "SQ") {
                    // convert sequence to list of values
                    const naturalValues = [];

                    Object.keys(data.Value).forEach(index => {
                        naturalValues.push(
                            DicomMetaDictionary.naturalizeDataset(
                                data.Value[index]
                            )
                        );
                    });

                    naturalDataset[naturalName] = naturalValues;
                } else {
                    naturalDataset[naturalName] = data.Value;
                }

                if (naturalDataset[naturalName].length === 1) {
                    const sqZero = naturalDataset[naturalName][0];
                    if (
                        sqZero &&
                        typeof sqZero === "object" &&
                        !sqZero.length
                    ) {
                        naturalDataset[naturalName] = addAccessors(
                            naturalDataset[naturalName],
                            sqZero
                        );
                    } else {
                        naturalDataset[naturalName] = sqZero;
                    }
                }
            }
        });

        return naturalDataset;
    }

    static denaturalizeValue(naturalValue) {
        let value = naturalValue;
        if (!Array.isArray(value)) {
            value = [value];
        } else {
            const thereIsUndefinedValues = naturalValue.some(
                item => item === undefined
            );
            if (thereIsUndefinedValues) {
                throw new Error(
                    "There are undefined values at the array naturalValue in DicomMetaDictionary.denaturalizeValue"
                );
            }
        }

        value = value.map(entry =>
            entry.constructor.name === "Number" ? String(entry) : entry
        );

        return value;
    }

    // keep the static function to support previous calls to the class
    static denaturalizeDataset(dataset, nameMap = DicomMetaDictionary.nameMap) {
        let unnaturalDataset = {};
        Object.keys(dataset).forEach(naturalName => {
            // check if it's a sequence
            const name = naturalName;
            const entry = nameMap[name];
            if (entry) {
                let dataValue = dataset[naturalName];

                if (dataValue === undefined) {
                    // handle the case where it was deleted from the object but is in keys
                    return;
                }
                // process this one entry
                const vr =
                    dataset._vrMap && dataset._vrMap[naturalName]
                        ? dataset._vrMap[naturalName]
                        : entry.vr;

                const dataItem = ValueRepresentation.addTagAccessors({ vr });

                dataItem.Value = dataset[naturalName];

                if (dataValue !== null) {
                    if (entry.vr === "ox") {
                        if (dataset._vrMap && dataset._vrMap[naturalName]) {
                            dataItem.vr = dataset._vrMap[naturalName];
                        } else {
                            log.error(
                                "No value representation given for",
                                naturalName
                            );
                        }
                    }

                    let vr = ValueRepresentation.createByTypeString(
                        dataItem.vr
                    );

                    dataItem.Value = DicomMetaDictionary.denaturalizeValue(
                        dataItem.Value
                    );

                    if (entry.vr === "SQ") {
                        let unnaturalValues = [];
                        for (
                            let datasetIndex = 0;
                            datasetIndex < dataItem.Value.length;
                            datasetIndex++
                        ) {
                            const nestedDataset = dataItem.Value[datasetIndex];
                            unnaturalValues.push(
                                DicomMetaDictionary.denaturalizeDataset(
                                    nestedDataset,
                                    nameMap
                                )
                            );
                        }
                        dataItem.Value = unnaturalValues;
                    }

                    if (!vr.isBinary() && vr.maxLength) {
                        dataItem.Value = dataItem.Value.map(value => {
                            let maxLength = vr.maxLength;
                            if (vr.rangeMatchingMaxLength) {
                                maxLength = vr.rangeMatchingMaxLength;
                            }

                            if (value.length > maxLength) {
                                log.warn(
                                    `Truncating value ${value} of ${naturalName} because it is longer than ${maxLength}`
                                );
                                return value.slice(0, maxLength);
                            } else {
                                return value;
                            }
                        });
                    }
                }

                const tag = DicomMetaDictionary.unpunctuateTag(entry.tag);
                unnaturalDataset[tag] = dataItem;
            } else {
                const validMetaNames = ["_vrMap", "_meta"];
                if (validMetaNames.indexOf(name) === -1) {
                    log.warn(
                        "Unknown name in dataset",
                        name,
                        ":",
                        dataset[name]
                    );
                }
            }
        });
        return unnaturalDataset;
    }

    static uid() {
        let uid = "2.25." + Math.floor(1 + Math.random() * 9);
        for (let index = 0; index < 38; index++) {
            uid = uid + Math.floor(Math.random() * 10);
        }
        return uid;
    }

    // date and time in UTC
    static date() {
        let now = new Date();
        return now.toISOString().replace(/-/g, "").slice(0, 8);
    }

    static time() {
        let now = new Date();
        return now.toISOString().replace(/:/g, "").slice(11, 17);
    }

    static dateTime() {
        // "2017-07-07T16:09:18.079Z" -> "20170707160918.079"
        let now = new Date();
        return now.toISOString().replace(/[:\-TZ]/g, "");
    }

    static _generateNameMap() {
        DicomMetaDictionary.nameMap = {};
        const entries = getAllStandardTagEntries();
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            const dict = {
                tag: e.tag,
                vr: e.vr,
                vm: e.vm,
                name: e.name,
                version: "DICOM"
            };
            DicomMetaDictionary.nameMap[e.name] = dict;
        }
        Object.keys(DicomMetaDictionary.dictionary).forEach(tag => {
            const dict = DicomMetaDictionary.dictionary[tag];
            if (dict && dict.version !== "PrivateTag") {
                DicomMetaDictionary.nameMap[dict.name] = dict;
            }
        });
    }

    static _generateCustomNameMap(dictionary) {
        const nameMap = {};
        if (dictionary === DicomMetaDictionary.dictionary) {
            const entries = getAllStandardTagEntries();
            for (let i = 0; i < entries.length; i++) {
                const e = entries[i];
                nameMap[e.name] = {
                    tag: e.tag,
                    vr: e.vr,
                    vm: e.vm,
                    name: e.name,
                    version: "DICOM"
                };
            }
            Object.keys(dictionary).forEach(tag => {
                const dict = dictionary[tag];
                if (dict && dict.version !== "PrivateTag") {
                    nameMap[dict.name] = dict;
                }
            });
            return nameMap;
        }
        Object.keys(dictionary).forEach(tag => {
            const dict = dictionary[tag];
            if (dict && dict.version !== "PrivateTag") {
                nameMap[dict.name] = dict;
            }
        });
        return nameMap;
    }

    static _generateUIDMap() {
        DicomMetaDictionary.sopClassUIDsByName = {};
        Object.keys(sopClassNamesByUID).forEach(uid => {
            const name = sopClassNamesByUID[uid];
            DicomMetaDictionary.sopClassUIDsByName[name] = uid;
        });
    }

    // denaturalizes dataset using custom dictionary and nameMap
    denaturalizeDataset(dataset) {
        return DicomMetaDictionary.denaturalizeDataset(
            dataset,
            this.customNameMap
        );
    }

    // Translates the DICOM specified encoding into a Web or native encoding target
    // so we can use decoding APIs to correctly handle DICOM buffers.
    static getNativeEncoding(dicomEncoding, ignoreErrors = false) {
        const coding = dicomEncoding.replace(/[_ ]/g, "-").toLowerCase();
        if (coding in encodingMapping) {
            return encodingMapping[coding];
        } else if (ignoreErrors) {
            log.warn(
                `Unsupported character set: ${coding}, using default 
                character set ${defaultEncoding}`
            );
        } else {
            throw Error(`Unsupported character set: ${coding}`);
        }
        return defaultEncoding;
    }
}

// TODO: Is this assignment necessary?
DicomMetaDictionary.sopClassNamesByUID = sopClassNamesByUID;
DicomMetaDictionary.encapsulatedSyntaxes = encapsulatedSyntaxes;
DicomMetaDictionary.encodingMapping = encodingMapping;

// Avoid loops in imports
ValueRepresentation.setDicomMetaDictionary(DicomMetaDictionary);

DicomMetaDictionary.dictionary = dictionary;

DicomMetaDictionary._generateNameMap();
DicomMetaDictionary._generateUIDMap();
