import { PN_COMPONENT_DELIMITER, VM_DELIMITER } from "../constants/dicom";

/**
 * Converts a PN string to the dicom+json equivalent, or returns the
 * original object
 * @param {string | object} value Part10 style PersonName (PN) string (ie 'A^B==C\D') or object
 * @param {bool} multiple if false returns the first valid PersonName, otherwise returns all PersonNames
 * @returns {object} dicom+json representation of PersonName value, or the same object.
 */
function pnStringToObject(value, multiple = true) {
    if (value == undefined) {
        return multiple ? [] : undefined;
    }
    if (typeof value === "string" || value instanceof String) {
        // Direct string assignment:
        //   naturalizedDataset.PatientName = "Doe^John";
        const values = value
            .split(String.fromCharCode(VM_DELIMITER))
            .filter(Boolean);
        const pnObj = values.map(function (v) {
            const components = v.split(
                String.fromCharCode(PN_COMPONENT_DELIMITER)
            );
            return {
                ...(components[0] ? { Alphabetic: components[0] } : {}),
                ...(components[1] ? { Ideographic: components[1] } : {}),
                ...(components[2] ? { Phonetic: components[2] } : {})
            };
        });
        return multiple ? pnObj : pnObj[0];
    } else {
        // Direct assignment:
        //   naturalizedDataset.PatientName = {Alphabetic: "John"};
        if (!Array.isArray(value) && multiple) {
            return [Object.assign({}, value)];
        }
        // Verbatim:
        //   naturalizedDataset.PatientName = [{Alphabetic: "John"}];
        return value;
    }
}

/**
 * Returns the dicom part10 equivalent string for a given json object.
 * @param {object | string} value
 * @returns {string} dicom part10 equivalent string
 */
function pnObjectToString(value) {
    if (typeof value === "string" || value instanceof String) {
        return value;
    }

    const pnDelim = String.fromCharCode(PN_COMPONENT_DELIMITER);
    if (!Array.isArray(value)) {
        value = [value];
    }
    return value
        .filter(Boolean)
        .map(function (v) {
            if (
                v === undefined ||
                typeof v === "string" ||
                v instanceof String
            ) {
                return v;
            }
            return [v.Alphabetic ?? "", v.Ideographic ?? "", v.Phonetic ?? ""]
                .join(pnDelim)
                .replace(new RegExp(`${pnDelim}*$`), "");
        })
        .join(String.fromCharCode(VM_DELIMITER));
}

/**
 * Overrides toJSON and toString to ensure JSON.stringify always returns
 * a valid dicom+json object, even when given a string such as "Doe^John".
 * @param {object} value value object which will be given the accessors. note
 *     for a string it must first be boxed: new String(value)
 * @returns {object} the same object
 */
function pnAddValueAccessors(value) {
    if (!value.__hasValueAccessors) {
        Object.defineProperty(value, "__hasValueAccessors", { value: true });
        Object.defineProperty(value, "toJSON", {
            value: function () {
                if (Array.isArray(this)) {
                    return this.filter(Boolean).map(x =>
                        pnStringToObject(x, false)
                    );
                } else {
                    return pnStringToObject(this);
                }
            }
        });
        // This override is mostly for testing; PN is always represented
        // by its dicom+json model, but serialization flattens it to a
        // part10 string.
        Object.defineProperty(value, "toString", {
            value: function () {
                return pnObjectToString(value);
            }
        });
    }
    return value;
}

const dicomJson = {
    pnObjectToString: pnObjectToString,
    pnConvertToJsonObject: pnStringToObject,
    pnAddValueAccessors: pnAddValueAccessors
};

export default dicomJson;
