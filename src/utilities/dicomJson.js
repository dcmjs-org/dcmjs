/**
 * Converts a naturalized PersonName (json) to a part10 PersonName (string)
 * @param {object} value json-style person name
 * @returns {string} part10 dicom representation of PersonName
 */
function pnDenaturalize(value) {
    if (value && typeof value === "object") {
        return `${value.Alphabetic ?? ""}=${value.Ideographic ?? ""}=${
            value.Phonetic ?? ""
        }`.replace(/=*$/, "");
    }
    return value;
}

/**
 * Overrides toJSON to ensure serialization from part10 to json outputs the
 * correct structure
 * @param {string} tag part10 PersonName (PN) tag
 */
function pnFromPart10(tag) {
    // Signal that this value was deserialized from a dcm/part10 file
    tag.values.__pnDcm = true;
    // To ensure proper json output, this value will be treated as the json dicom
    // equivalent when serializing.
    tag.values.toJSON = function () {
        const components = this[0]?.split("=");
        if (components && components.length) {
            return [
                {
                    Alphabetic: components[0],
                    Ideographic: components[1],
                    Phonetic: components[2]
                }
            ];
        }
        return [];
    };
}

/**
 * Naturalizes a PN loaded from any source (part10 or json) by adding
 * accessors to the name components, or overriding toString to allow
 * denaturalization. See the note in the function for further details.
 * @param {object} data object or string to be normalized to dicom json
 */
function pnNormalizeDicomToJson(data) {
    // "PN" is one of the few deviations from the binary model, see:
    // https://dicom.nema.org/dicom/2013/output/chtml/part18/sect_F.2.html

    // If the PN object was created from a dcm file, it will be a ["string"].
    // In this case ValueRepresentation will add a toJSON overload to the
    // containing array object. If the object was created from JSON (by
    // DICOMWeb for instance), toJSON should work as expected, and the
    // denaturalization process will handle the converstion.

    // This following code provides a consistent accessor experience for
    // the naturalized dataset. If the value is a string, it mocks a json
    // object, and if it's a json object it mocks a string by overriding
    // toString. The latter ensures the ValueRepresentation output is
    // correct.
    if (
        data.Value.__pnDcm ||
        (data.Value &&
            Array.isArray(data.Value) &&
            typeof data.Value[0] == "string")
    ) {
        data.Value.__objectLike = true;
        Object.defineProperty(data.Value, "Alphabetic", {
            get() {
                return this[0]?.split("=")[0];
            },
            set(value) {
                this[0] = `${value ?? ""}=${this.Ideographic ?? ""}=${
                    this.Phonetic ?? ""
                }`.replace(/=*$/, "");
            }
        });
        Object.defineProperty(data.Value, "Ideographic", {
            get() {
                return this[0]?.split("=")[1];
            },
            set(value) {
                this[0] = `${this.Alphabetic ?? ""}=${value ?? ""}=${
                    this.Phonetic ?? ""
                }`.replace(/=*$/, "");
            }
        });
        Object.defineProperty(data.Value, "Phonetic", {
            get() {
                return this[0]?.split("=")[2];
            },
            set(value) {
                this[0] = `${this.Alphabetic ?? ""}=${this.Ideographic ?? ""}=${
                    value ?? ""
                }`.replace(/=*$/, "");
            }
        });
    } else {
        if (data.Value && Array.isArray(data.Value)) {
            if (typeof data.Value[0] === "object") {
                // To allow serialization to part10 when writing directly from dicom json
                data.Value.toString = function () {
                    return [
                        data.Value[0].Alphabetic ?? "",
                        data.Value[0].Ideographic ?? "",
                        data.Value[0].Phonetic ?? ""
                    ]
                        .join("=")
                        .replace(/=*$/, "");
                };
            }
        } else {
            throw new Error(
                data.Value,
                "Cannot determine value of PN (PersonName) tag"
            );
        }
    }
}

const dicomJson = {
    pnNormalizeDicomToJson: pnNormalizeDicomToJson,
    pnFromPart10: pnFromPart10,
    pnDenaturalize: pnDenaturalize
};

export default dicomJson;
