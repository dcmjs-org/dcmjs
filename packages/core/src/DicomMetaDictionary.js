import { dictionary, lookupRegisteredTagByName } from "./dictionary.fast.js";
import { getAllStandardTagEntries } from "./dicom.lookup.js";
import log from "./log.js";
import addAccessors from "./utilities/addAccessors.js";
import isMultiVM from "./utilities/isMultiVM.js";
import BINARY_VRS from "./utilities/binaryVRs.js";
import {
    checkBinaryAs,
    naturalBinaryFragment
} from "./utilities/binaryFragment.js";
import { ValueRepresentation } from "./ValueRepresentation.js";
import {
    isPrivateTag,
    placePrivateElements,
    expandPrivateBlocks
} from "./utilities/privateBlocks.js";
import { recordVr } from "./utilities/vrMap.js";

/**
 * The naturalized value of one DICOM JSON element (see naturalizeDataset).
 */
function naturalizeElement(data, entry, options) {
    if (data.Value === undefined || data.Value === null) {
        // type 2 (present, empty) is null; binary keeps its reference
        if (data.InlineBinary) {
            return { InlineBinary: data.InlineBinary };
        }
        if (data.BulkDataURI) {
            return { BulkDataURI: data.BulkDataURI };
        }
        return null;
    }

    const multi = isMultiVM(entry?.vm);
    if (data.vr === "SQ") {
        const items = data.Value.map(item =>
            DicomMetaDictionary.naturalizeDataset(item, options)
        );
        return items.length === 1 && !multi ? addAccessors(items) : items;
    }

    let value = data.Value;
    if (BINARY_VRS.has(data.vr)) {
        // a binary Value lists frames or fragments, not a VM: keep the list
        return value.map(fragment =>
            naturalBinaryFragment(fragment, options.binaryAs)
        );
    }
    if (!multi) {
        if (value.length === 0) return null;
        if (value.length === 1) value = value[0];
    }
    return ValueRepresentation.addValueAccessorsFor(data.vr, value);
}

export class DicomMetaDictionary {
    // intakes a custom dictionary that will be used to parse/denaturalize the dataset
    constructor(customDictionary) {
        this.customDictionary = customDictionary;
        this.customNameMap =
            DicomMetaDictionary._generateCustomNameMap(customDictionary);
    }

    /**
     * The dictionary entry for a Tag instance (punctuated-string keyed).
     * Relocated from DicomMessage.lookupTag, which now delegates here, so
     * the streaming decode core can resolve VRs without the legacy reader.
     */
    static lookupTag(tag) {
        return DicomMetaDictionary.dictionary[tag.toString()];
    }

    static punctuateTag(rawTag) {
        if (rawTag.indexOf(",") !== -1) {
            return rawTag;
        }
        if (rawTag.length === 8 && rawTag === rawTag.match(/[0-9a-fA-F]*/)[0]) {
            var tag = rawTag.toUpperCase();
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
        if (item != undefined) {
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
            if (data.vr == "SQ") {
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
                    if (item.constructor.name == "String") {
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
            if (data.vr == "SQ") {
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
     * Converts a DICOM JSON Model dataset to a naturalized dataset (1.0 rules):
     * - member names are dictionary keywords, not group/element tags;
     * - a value whose dictionary VM is "1" or "0-1" is a single value (null
     *   when empty); any other VM keeps a list, also for one value. A scalar
     *   VM with more than one value keeps the list. A binary VR (OB, OW, UN,
     *   ...) always keeps the list, because its Value lists frames;
     * - a sequence with one item (and a VM of 1) is that item object, with a
     *   hidden [0] and length (see addAccessors); otherwise it is a list;
     * - PN values get their value accessors here, when the value is built;
     * - private elements group by reserved block under `${group}:${creator}`
     *   keys, with non-enumerable hex-tag aliases (see privateBlocks.js).
     *
     * The result is a plain object: there is no Proxy. The 0.x shapes are in
     * the DicomMetaDictionary of @dcmjs-org/legacy.
     *
     * @param {Object} dataset - DICOM JSON Model dataset
     * @param {Object} [options]
     * @param {"ArrayBuffer"|"Uint8Array"} [options.binaryAs="ArrayBuffer"] -
     *   the type of each fragment or frame of a binary value
     */
    static naturalizeDataset(dataset, options = {}) {
        options = { ...options, binaryAs: checkBinaryAs(options.binaryAs) };
        const naturalDataset = { _vrMap: {} };
        const privateElements = [];

        Object.keys(dataset).forEach(tag => {
            const data = dataset[tag];
            const punctuatedTag = DicomMetaDictionary.punctuateTag(tag);
            const entry = DicomMetaDictionary.dictionary[punctuatedTag];
            if (isPrivateTag(tag)) {
                privateElements.push({
                    tag,
                    vr: data.vr,
                    value: naturalizeElement(data, entry, options),
                    entry
                });
                return;
            }
            // no dictionary entry: the tag stays the key, and the VR goes
            // into _vrMap so denaturalizeDataset can rebuild it
            const naturalName = entry ? entry.name : tag;
            recordVr(naturalDataset._vrMap, naturalName, entry, data.vr);

            naturalDataset[naturalName] = naturalizeElement(
                data,
                entry,
                options
            );
        });

        placePrivateElements(
            naturalDataset,
            naturalDataset._vrMap,
            privateElements
        );
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
            entry.constructor.name == "Number" ? String(entry) : entry
        );

        return value;
    }

    // keep the static function to support previous calls to the class
    static denaturalizeDataset(dataset, nameMap = DicomMetaDictionary.nameMap) {
        var unnaturalDataset = {};
        // reserved private blocks become a creator plus hex-tag elements
        dataset = expandPrivateBlocks(dataset);
        Object.keys(dataset).forEach(naturalName => {
            // check if it's a sequence
            var name = naturalName;
            var entry = nameMap[name];
            if (!entry) {
                // registerTag() names are kept in a registry-local index
                // instead of being written into the shared nameMap, so a
                // registered keyword denaturalizes symmetrically without
                // naturalizeDataset ever mutating global state
                entry = lookupRegisteredTagByName(name);
            }
            if (
                !entry &&
                /^[0-9A-Fa-f]{8}$/.test(name) &&
                dataset._vrMap &&
                dataset._vrMap[name]
            ) {
                // private/unknown element kept under its hex tag by
                // naturalizeDataset: rebuild it with the VR recorded in
                // _vrMap so the element round-trips instead of being
                // dropped; without a recorded VR it still falls through
                // to the warning below
                entry = {
                    tag: DicomMetaDictionary.punctuateTag(name),
                    vr: dataset._vrMap[name],
                    name: name,
                    version: "PrivateTag"
                };
            }
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

                var dataItem = { vr };

                dataItem.Value = dataset[naturalName];

                if (dataValue !== null) {
                    if (entry.vr == "ox") {
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

                    if (entry.vr == "SQ") {
                        var unnaturalValues = [];
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

                    // PN gets its value accessors when the value is built
                    dataItem.Value = vr.addValueAccessors(dataItem.Value);
                }

                var tag = DicomMetaDictionary.unpunctuateTag(entry.tag);
                unnaturalDataset[tag] = dataItem;
            } else {
                const validMetaNames = ["_vrMap", "_meta"];
                if (validMetaNames.indexOf(name) == -1) {
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

    /**
     * Generates a UID with the "2.25" root: the decimal encoding of a
     * freshly generated 128-bit RFC 4122 version 4 UUID, per PS3.5
     * Annex B.2 / ITU-T X.667. The integer part is at most 39 digits
     * (2^128 - 1), so the UID is at most 44 characters and never has a
     * leading zero.
     */
    static uid() {
        const bytes = new Uint8Array(16);
        const cryptoLib =
            typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
        if (cryptoLib && typeof cryptoLib.getRandomValues === "function") {
            cryptoLib.getRandomValues(bytes);
        } else {
            // Fallback for environments without Web Crypto (not
            // cryptographically strong, but preserves the UUID format).
            for (let index = 0; index < 16; index++) {
                bytes[index] = Math.floor(Math.random() * 256);
            }
        }
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
        let hex = "";
        for (let index = 0; index < 16; index++) {
            hex += bytes[index].toString(16).padStart(2, "0");
        }
        return "2.25." + BigInt("0x" + hex).toString();
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
            var dict = dictionary[tag];
            if (dict && dict.version != "PrivateTag") {
                nameMap[dict.name] = dict;
            }
        });
        return nameMap;
    }

    static _generateUIDMap() {
        DicomMetaDictionary.sopClassUIDsByName = {};
        Object.keys(DicomMetaDictionary.sopClassNamesByUID).forEach(uid => {
            var name = DicomMetaDictionary.sopClassNamesByUID[uid];
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
}

// Subset of those listed at:
// http://dicom.nema.org/medical/dicom/current/output/html/part04.html#sect_B.5
DicomMetaDictionary.sopClassNamesByUID = {
    "1.2.840.10008.5.1.4.1.1.20": "NMImage",
    "1.2.840.10008.5.1.4.1.1.2": "CTImage",
    "1.2.840.10008.5.1.4.1.1.2.1": "EnhancedCTImage",
    "1.2.840.10008.5.1.4.1.1.2.2": "LegacyConvertedEnhancedCTImage",
    "1.2.840.10008.5.1.4.1.1.3.1": "USMultiframeImage",
    "1.2.840.10008.5.1.4.1.1.4": "MRImage",
    "1.2.840.10008.5.1.4.1.1.4.1": "EnhancedMRImage",
    "1.2.840.10008.5.1.4.1.1.4.2": "MRSpectroscopy",
    "1.2.840.10008.5.1.4.1.1.4.3": "EnhancedMRColorImage",
    "1.2.840.10008.5.1.4.1.1.4.4": "LegacyConvertedEnhancedMRImage",
    "1.2.840.10008.5.1.4.1.1.6.1": "USImage",
    "1.2.840.10008.5.1.4.1.1.6.2": "EnhancedUSVolume",
    "1.2.840.10008.5.1.4.1.1.7": "SecondaryCaptureImage",
    "1.2.840.10008.5.1.4.1.1.30": "ParametricMapStorage",
    "1.2.840.10008.5.1.4.1.1.66": "RawData",
    "1.2.840.10008.5.1.4.1.1.66.1": "SpatialRegistration",
    "1.2.840.10008.5.1.4.1.1.66.2": "SpatialFiducials",
    "1.2.840.10008.5.1.4.1.1.66.3": "DeformableSpatialRegistration",
    "1.2.840.10008.5.1.4.1.1.66.4": "Segmentation",
    "1.2.840.10008.5.1.4.1.1.66.7": "LabelmapSegmentation", // Labelmap Segmentation SOP Class UID
    "1.2.840.10008.5.1.4.1.1.67": "RealWorldValueMapping",
    "1.2.840.10008.5.1.4.1.1.88.11": "BasicTextSR",
    "1.2.840.10008.5.1.4.1.1.88.22": "EnhancedSR",
    "1.2.840.10008.5.1.4.1.1.88.33": "ComprehensiveSR",
    "1.2.840.10008.5.1.4.1.1.88.34": "Comprehensive3DSR",
    "1.2.840.10008.5.1.4.1.1.128": "PETImage",
    "1.2.840.10008.5.1.4.1.1.130": "EnhancedPETImage",
    "1.2.840.10008.5.1.4.1.1.128.1": "LegacyConvertedEnhancedPETImage",
    "1.2.840.10008.5.1.4.1.1.77.1.5.1": "OphthalmicPhotography8BitImage",
    "1.2.840.10008.5.1.4.1.1.77.1.5.4": "OphthalmicTomographyImage"
};

// Avoid loops in imports
ValueRepresentation.setDicomMetaDictionary(DicomMetaDictionary);

DicomMetaDictionary.dictionary = dictionary;

DicomMetaDictionary._generateNameMap();
DicomMetaDictionary._generateUIDMap();
