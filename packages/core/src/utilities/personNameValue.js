import dicomJson from "./dicomJson.js";

/**
 * A PN value in the naturalized form (NAT-U-VAL-5): the component object
 * `{ Alphabetic, Ideographic, Phonetic }`, or a list of them, with the PN
 * value accessors (String() gives the DICOM PN string).
 *
 * The input is a PN string (`"Doe^John"`, `"A^B=C\\D^E"`), a component
 * object, or a list of strings and objects. `length` is the value count:
 * 1 gives one component object (null for no value), and any other value or
 * none gives a list ([] for no value). A length of 1 with more than one
 * value keeps the list.
 *
 * @param {string|Object|Array|null|undefined} value
 * @param {number} [length]
 * @returns {Object|Object[]|null}
 */
export function toPersonNameValue(value, length) {
    const single = length === 1;
    // undefined stays undefined: denaturalize omits the attribute
    if (value === undefined) return undefined;
    if (value === null) return single ? null : [];
    // flat(Infinity): a nested list of names is one list of names; a null
    // name is an empty name, so the later names keep their position
    const list = [value]
        .flat(Infinity)
        .flatMap(item =>
            item == null ? [{}] : dicomJson.pnConvertToJsonObject(item, true)
        );
    if (single && list.length <= 1) {
        const name = list[0];
        return name && Object.keys(name).length
            ? dicomJson.pnAddValueAccessors(name)
            : null;
    }
    return dicomJson.pnAddValueAccessors(list);
}

/**
 * Makes `target[key]` a PN attribute with a converting setter: an assigned
 * string, object or list is stored as toPersonNameValue(value, length). The
 * property stays enumerable, so Object.keys, JSON and denaturalize see it.
 *
 * @param {Object} target - a naturalized dataset or sequence item
 * @param {string} key - the attribute key, for example "PatientName"
 * @param {number} [length] - 1 for a single value (VM 1), else a list
 * @param {*} [value] - the initial value; target[key] when not given
 */
export function definePersonNameAccessor(target, key, length, ...value) {
    let stored = toPersonNameValue(
        value.length ? value[0] : target[key],
        length
    );
    Object.defineProperty(target, key, {
        get: () => stored,
        set: value => {
            stored = toPersonNameValue(value, length);
        },
        enumerable: true,
        configurable: true
    });
}
